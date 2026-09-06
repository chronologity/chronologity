import { render } from "@testing-library/react-native";
import { EmptyState } from "./empty-state";

describe("saying that there is nothing here", () => {
  it("says what is absent and what to do next", async () => {
    // accessibility.md:814 — "No Moments occurred during this period" is more
    // useful than an empty visual Timeline. A blank screen is not an answer.
    const { getByText } = await render(
      <EmptyState action="Your history starts with a Moment." title="Nothing here yet" />,
    );

    expect(getByText("Nothing here yet")).toBeTruthy();
    expect(getByText("Your history starts with a Moment.")).toBeTruthy();
  });

  it("works without a next step, for the states that have none", async () => {
    const { getByText } = await render(<EmptyState title="Nothing here yet" />);

    expect(getByText("Nothing here yet")).toBeTruthy();
  });

  it("reads as one thing to a screen reader rather than as loose text", async () => {
    const { getByTestId } = await render(<EmptyState testID="empty" title="Nothing here yet" />);

    expect(getByTestId("empty").props.accessible).toBe(true);
  });
});
