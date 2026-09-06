import { renderHook, waitFor } from "@testing-library/react-native";
import { AccessibilityInfo, useColorScheme } from "react-native";
import { useTheme } from "./use-theme";

jest.mock("react-native/Libraries/Utilities/useColorScheme");

const scheme = useColorScheme as jest.MockedFunction<typeof useColorScheme>;

describe("choosing an appearance and an amount of movement", () => {
  beforeEach(() => {
    jest.restoreAllMocks();
    scheme.mockReturnValue("light");
    jest.spyOn(AccessibilityInfo, "isReduceMotionEnabled").mockResolvedValue(false);
    jest
      .spyOn(AccessibilityInfo, "addEventListener")
      .mockReturnValue({ remove: () => undefined } as never);
  });

  it("follows the platform into dark", async () => {
    scheme.mockReturnValue("dark");

    const { result } = await renderHook(() => useTheme());

    expect(result.current.theme.name).toBe("dark");
    expect(result.current.theme.dark).toBe(true);
  });

  it("renders light when the platform has not said", async () => {
    // React Native 0.86 spells "no answer yet" as "unspecified" rather than
    // null. Light is the right default: it is what `app.json` shipped with.
    scheme.mockReturnValue("unspecified");

    const { result } = await renderHook(() => useTheme());

    expect(result.current.theme.name).toBe("light");
  });

  it("reduces motion when the platform asks", async () => {
    jest.spyOn(AccessibilityInfo, "isReduceMotionEnabled").mockResolvedValue(true);

    const { result } = await renderHook(() => useTheme());

    await waitFor(() => {
      expect(result.current.reducedMotion).toBe(true);
    });
  });

  it("reduces motion when the account asks and the platform does not", async () => {
    // The merge rule. Somebody who told Chronologity should not be overruled
    // because the phone disagrees.
    const { result } = await renderHook(() => useTheme(true));

    expect(result.current.reducedMotion).toBe(true);
  });

  it("keeps motion when neither asks", async () => {
    const { result } = await renderHook(() => useTheme(false));

    expect(result.current.reducedMotion).toBe(false);
    expect(result.current.duration("standard")).toBeGreaterThan(0);
  });

  it("treats an unknown account preference as no answer, not as no", async () => {
    // Undefined means preferences have not been read yet. It must not silently
    // become a decision that somebody wants motion.
    jest.spyOn(AccessibilityInfo, "isReduceMotionEnabled").mockResolvedValue(true);

    const { result } = await renderHook(() => useTheme(undefined));

    await waitFor(() => {
      expect(result.current.reducedMotion).toBe(true);
    });
  });

  it("collapses every duration to nothing under reduced motion", async () => {
    const { result } = await renderHook(() => useTheme(true));

    expect(result.current.duration("fast")).toBe(0);
    expect(result.current.duration("standard")).toBe(0);
  });

  it("stops listening when it goes away", async () => {
    const remove = jest.fn();
    jest.spyOn(AccessibilityInfo, "addEventListener").mockReturnValue({ remove } as never);

    const { unmount } = await renderHook(() => useTheme());
    // `unmount` is a promise in RNTL 14, like `render` and `fireEvent`.
    await unmount();

    expect(remove).toHaveBeenCalled();
  });
});
