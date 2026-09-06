import { operations } from "@chronologity/api-client";
import { StatusBar } from "expo-status-bar";
import { StyleSheet, Text, View } from "react-native";

/**
 * The application.
 *
 * A placeholder while the providers and navigation are wired. It imports an
 * operation deliberately: the one thing this bootstrap has to prove before
 * anything is built on it is that Metro can resolve the workspace's ESM
 * packages, and an import Metro must follow is the only proof of that.
 *
 * @returns The root element.
 */
export default function App(): React.JSX.Element {
  return (
    <View style={styles.container}>
      <Text>{operations.health.checkLiveness.template}</Text>
      <StatusBar style="auto" />
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    alignItems: "center",
    backgroundColor: "#fff",
    flex: 1,
    justifyContent: "center",
  },
});
