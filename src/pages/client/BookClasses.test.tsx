import { fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import BookClasses from "./BookClasses";

const mocks = vi.hoisted(() => ({
  navigate: vi.fn(),
}));

vi.mock("react-router-dom", async () => {
  const actual = await vi.importActual<typeof import("react-router-dom")>("react-router-dom");
  return { ...actual, useNavigate: () => mocks.navigate };
});

vi.mock("@tanstack/react-query", async () => {
  const actual = await vi.importActual<typeof import("@tanstack/react-query")>("@tanstack/react-query");
  return {
    ...actual,
    useQuery: ({ queryKey }: { queryKey: string[] }) => {
      if (queryKey[0] === "public-classes") {
        return {
          data: {
            data: [{
              id: "full-class",
              class_type_name: "Reformer",
              class_category: "pilates",
              start_time: "2026-08-21T10:00:00-06:00",
              end_time: "2026-08-21T10:55:00-06:00",
              current_bookings: 8,
              max_capacity: 8,
            }],
          },
          isLoading: false,
        };
      }

      if (queryKey[0] === "my-bookings") {
        return { data: { data: [] }, isLoading: false };
      }

      return {
        data: {
          data: {
            id: "membership",
            status: "active",
            class_category: "pilates",
            classes_remaining: 4,
          },
        },
        isLoading: false,
      };
    },
  };
});

vi.mock("@/components/layout/ClientAuthGuard", () => ({
  ClientAuthGuard: ({ children }: { children: React.ReactNode }) => children,
}));

vi.mock("@/components/layout/ClientLayout", () => ({
  default: ({ children }: { children: React.ReactNode }) => children,
}));

describe("BookClasses waitlist entry", () => {
  afterEach(() => {
    vi.useRealTimers();
    mocks.navigate.mockReset();
  });

  it("allows a client to select a full future class", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-08-20T12:00:00-06:00"));

    render(<BookClasses />);

    const classButton = screen.getByRole("button", {
      name: /Reformer.*Lleno · lista de espera/i,
    });

    expect(classButton).toBeEnabled();
    fireEvent.click(classButton);
    expect(mocks.navigate).toHaveBeenCalledWith("/app/classes/full-class");
  });
});
