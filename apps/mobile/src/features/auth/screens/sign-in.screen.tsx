import { operations, type ApiClient } from "@chronologity/api-client";
import { useMutation } from "@tanstack/react-query";
import { useState } from "react";
import { View } from "react-native";
import { spacing } from "../../../app/theme/spacing";
import { ErrorState } from "../../../components/feedback/error-state";
import { Screen } from "../../../components/layout/screen";
import { AppButton } from "../../../components/primitives/app-button";
import { AppInput } from "../../../components/primitives/app-input";
import { AppText } from "../../../components/primitives/app-text";
import { useSession } from "../../../app/providers";

/**
 * Signing in.
 *
 * The bootstrap's one authentication route, deliberately: the API offers
 * eighteen, and proving that credentials arrive, persist, and come back on the
 * next launch needs exactly one of them. Magic links, phone, and registration
 * are Phase 12's (`roadmap.md:1244`).
 *
 * **The client is never the authority.** What this screen does with a refusal
 * is show it. It does not decide whether the credentials were right, whether the
 * account exists, or whether somebody may proceed — `authorization.md:833` and
 * `authentication.md:1602` are explicit that none of those are a client's to
 * answer, and `authentication.md:1156` limits what a refusal may even reveal.
 * So the message comes from the code, and nothing is inferred from which field
 * was filled in.
 *
 * Adopting the credentials is what persists them: `createBackend` writes the
 * refresh half through on every change.
 *
 * **The fields carry visible labels now, and that is a fix rather than a
 * polish.** They were named by `placeholder` alone, which vanishes the moment
 * somebody types — `accessibility.md:774`: "Placeholder text must not substitute
 * for a persistent accessible label." `AppInput` has no way to be built without
 * one. The `textContentType` and `autoComplete` hints are what let a password
 * manager fill this in, which `accessibility.md:1065` asks for by name.
 */

/** What the screen needs to do its one job. */
export interface SignInScreenProps {
  readonly client: ApiClient;
}

/**
 * Render the sign-in screen.
 *
 * @param props - The client to sign in through.
 * @returns The element.
 */
export function SignInScreen({ client }: SignInScreenProps): React.JSX.Element {
  const { session } = useSession();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");

  const signIn = useMutation({
    mutationFn: async () =>
      await operations.authentication.createSessionFromPassword(client, {
        body: { email, password },
      }),
    onSuccess: (credentials) => {
      session.adopt(credentials);
    },
  });

  return (
    <Screen centred testID="sign-in-screen">
      <View style={{ gap: spacing.lg, width: "100%" }}>
        <AppText style={{ textAlign: "center" }} variant="display">
          Chronologity
        </AppText>

        <AppInput
          autoCapitalize="none"
          autoComplete="email"
          keyboardType="email-address"
          label="Email"
          onChangeText={setEmail}
          testID="sign-in-email"
          textContentType="emailAddress"
          value={email}
        />

        <AppInput
          autoCapitalize="none"
          autoComplete="current-password"
          label="Password"
          onChangeText={setPassword}
          secureTextEntry
          testID="sign-in-password"
          textContentType="password"
          value={password}
        />

        <AppButton
          busy={signIn.isPending}
          label="Sign in"
          onPress={() => {
            signIn.mutate();
          }}
          testID="sign-in-submit"
        />

        {signIn.isError ? <ErrorState error={signIn.error} /> : null}
      </View>
    </Screen>
  );
}
