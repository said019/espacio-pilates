import { render, screen, cleanup } from "@testing-library/react";
import { afterEach, expect, it } from "vitest";
import { RosterPhone } from "./RosterPhone";

afterEach(cleanup);
it("shows the complete phone and a calling link", () => {
  render(<RosterPhone phone="+52 444 123 4567" />);
  expect(screen.getByRole("link").getAttribute("href")).toBe("tel:+524441234567");
  expect(screen.getByRole("link").textContent).toBe("+52 444 123 4567");
});
it("explains when a guest or member has no recorded phone", () => {
  render(<RosterPhone phone={null} />);
  expect(screen.getByText("Sin teléfono registrado")).toBeTruthy();
  expect(screen.queryByRole("link")).toBeNull();
});
