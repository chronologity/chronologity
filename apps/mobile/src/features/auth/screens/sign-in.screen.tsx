import { operations, type ApiClient } from "@chronologity/api-client";
import { useMutation } from "@tanstack/react-query";
import { useState } from "react";
import { ActivityIndicator, Pressable, StyleSheet, Text, TextInput, View } from "react-native";
import { ErrorState } from "../../../components/feedback/error-state";
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
    <View style={styles.container} testID="sign-in-screen">
      <Text style={styles.title}>Chronologity</Text>

      <TextInput
        accessibilityLabel="Email"
        autoCapitalize="none"
        autoComplete="email"
        keyboardType="email-address"
        onChangeText={setEmail}
        placeholder="Email"
        style={styles.field}
        testID="sign-in-email"
        value={email}
      />

      <TextInput
        accessibilityLabel="Password"
        autoCapitalize="none"
        onChangeText={setPassword}
        placeholder="Password"
        secureTextEntry
        style={styles.field}
        testID="sign-in-password"
        value={password}
      />

      <Pressable
        accessibilityRole="button"
        disabled={signIn.isPending}
        onPress={() => {
          signIn.mutate();
        }}
        style={styles.button}
        testID="sign-in-submit"
      >
        {signIn.isPending ? (
          <ActivityIndicator color="#fff" />
        ) : (
          <Text style={styles.buttonLabel}>Sign in</Text>
        )}
      </Pressable>

      {signIn.isError ? <ErrorState error={signIn.error} /> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  button: {
    alignItems: "center",
    backgroundColor: "#1a1a1a",
    borderRadius: 8,
    paddingVertical: 14,
  },
  buttonLabel: { color: "#fff", fontWeight: "600" },
  container: { flex: 1, justifyContent: "center", padding: 32 },
  field: {
    borderColor: "#ddd",
    borderRadius: 8,
    borderWidth: 1,
    marginBottom: 12,
    paddingHorizontal: 14,
    paddingVertical: 12,
  },
  title: { fontSize: 28, fontWeight: "700", marginBottom: 32, textAlign: "center" },
});
