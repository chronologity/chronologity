// `registerRootComponent` calls `AppRegistry.registerComponent("main", () => App)`
// and sets the environment up the same way whether the app is loaded in Expo Go
// or in a native build.
import { registerRootComponent } from "expo";
// Before anything can reach for them. React Native's own `URL` and
// `URLSearchParams` are a homemade subset, and `packages/api-client` builds a
// query string with the latter on every paged request (ADR-153, amended).
import "react-native-url-polyfill/auto";

import App from "./src/app/App";

registerRootComponent(App);
