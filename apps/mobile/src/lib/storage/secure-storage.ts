import * as SecureStore from "expo-secure-store";
import { z } from "zod";

/**
 * The one thing on this device worth protecting.
 *
 * **What is stored, and what deliberately is not.** A refresh credential is
 * long-lived and can mint access tokens, so `authentication.md:628-644` requires
 * it live in platform-secure storage and names what must never hold it: "plain
 * AsyncStorage; logs; analytics payloads; Redux debugging output; crash reports;
 * URLs; ordinary plaintext files." An access token is none of those things —
 * it expires in minutes and is worthless by the next launch — so it is held in
 * memory and written nowhere.
 *
 * Three fields go in: the Session's identity, the refresh credential, and when
 * that credential lapses. The last is not decoration. Without it, an app
 * returning after a month spends a request discovering what it could have known
 * before making one.
 *
 * **On the platforms underneath.** iOS keeps this in the Keychain, which
 * survives uninstalling the app — so a reinstall can find a Session belonging to
 * whoever used the device last, and reads must tolerate a credential the server
 * has long since revoked. Android encrypts it with the Keystore and loses it on
 * uninstall. Neither difference is worth hiding, because the handling is the
 * same either way: what comes back is a claim, never a proof
 * (`authentication.md:1271-1279`).
 *
 * **Nothing here throws at the caller.** A device with a locked or unavailable
 * keychain is a device that starts signed out, which is a state the application
 * already has to render. It is not a crash on launch.
 */

/** Where the credential lives. Namespaced, because a key is a public name. */
const KEY = "chronologity.session";

/**
 * What survives a launch.
 *
 * Parsed on the way out rather than trusted: this is the one input that arrives
 * from outside the running program, and a partial write from a killed process
 * would otherwise become a malformed refresh request.
 */
export const storedSessionSchema = z.object({
  sessionId: z.uuid(),
  refreshToken: z.string().min(1),
  refreshTokenExpiresAt: z.iso.datetime({ offset: true }),
});

export type StoredSession = z.infer<typeof storedSessionSchema>;

/**
 * Remember a Session across launches.
 *
 * @param session - What to keep. Only ever the refresh half.
 * @returns Whether it was stored. False rather than throwing, because failing
 *   to persist is not a reason to fail the sign-in that just succeeded — the
 *   person is signed in now, and will simply have to sign in again next time.
 */
export async function rememberSession(session: StoredSession): Promise<boolean> {
  try {
    await SecureStore.setItemAsync(KEY, JSON.stringify(session), {
      // The credential is needed when the app resumes, which can happen in the
      // background; it is never needed before the device has been unlocked once
      // since boot.
      keychainAccessible: SecureStore.AFTER_FIRST_UNLOCK,
    });

    return true;
  } catch {
    return false;
  }
}

/**
 * Read back what the last launch left.
 *
 * @returns The stored Session, or undefined when there is none, when the store
 *   cannot be read, or when what came back is not the shape that was written.
 *   All three mean the same thing to a caller: start signed out.
 */
export async function recallSession(): Promise<StoredSession | undefined> {
  try {
    const raw = await SecureStore.getItemAsync(KEY);

    if (raw === null) {
      return undefined;
    }

    const parsed = storedSessionSchema.safeParse(JSON.parse(raw));

    return parsed.success ? parsed.data : undefined;
  } catch {
    return undefined;
  }
}

/**
 * Forget it.
 *
 * Called on sign-out and whenever the server disowns the Session. Deleting the
 * local copy is not logout on its own — `authentication.md:516` is explicit that
 * the Session lives server-side until revoked — but it is the half this device
 * is responsible for, and it must happen even when the revocation call fails
 * (`authentication.md:536`).
 *
 * @returns Nothing. A failure to delete is swallowed for the same reason the
 *   others are: there is no better outcome available and nothing a person could
 *   do about it.
 */
export async function forgetSession(): Promise<void> {
  try {
    await SecureStore.deleteItemAsync(KEY);
  } catch {
    // Deliberately empty.
  }
}
