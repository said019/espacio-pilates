import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, describe, expect, it, vi } from "vitest";
import { BookingDialog } from "./BookingDialog";

const mocks = vi.hoisted(() => ({
  post: vi.fn(),
  toast: vi.fn(),
}));

vi.mock("@/lib/api", () => ({
  default: { post: mocks.post },
}));

vi.mock("@/stores/authStore", () => ({
  useAuthStore: (selector: (state: { user: { id: string } }) => unknown) =>
    selector({ user: { id: "client-1" } }),
}));

vi.mock("@/hooks/use-toast", () => ({
  useToast: () => ({ toast: mocks.toast }),
}));

vi.mock("@/hooks/useCancellationConfig", () => ({
  useCancellationConfig: () => ({ min_hours: 12, reschedule_hours: 8 }),
}));

describe("BookingDialog waitlist", () => {
  afterEach(() => {
    mocks.post.mockReset();
    mocks.toast.mockReset();
  });

  it("lets a signed-in client join a full class in the selected branch", async () => {
    mocks.post.mockResolvedValue({ data: { booking: { status: "waitlist" } } });

    render(
      <MemoryRouter>
        <BookingDialog
          open
          onOpenChange={vi.fn()}
          classData={{
            id: "functional-full",
            type: "Funcional",
            time: "08:00",
            duration: "55 min",
            spots: 0,
            branchId: "22222222-2222-4222-8222-222222222222",
            branchCode: "pozos",
            branchName: "Pozos",
            branchAddress: null,
            program: "functional",
          }}
        />
      </MemoryRouter>,
    );

    const button = screen.getByRole("button", { name: "Unirme a lista de espera" });
    expect(button).toBeEnabled();
    fireEvent.click(button);

    await waitFor(() => expect(mocks.post).toHaveBeenCalledWith("/bookings", {
      classId: "functional-full",
      branchId: "22222222-2222-4222-8222-222222222222",
      branch_id: "22222222-2222-4222-8222-222222222222",
      program: "functional",
    }));
    expect(await screen.findByText("Estás en la lista de espera")).toBeInTheDocument();
    expect(screen.queryByText(/Dirección por confirmar/i)).not.toBeInTheDocument();
  });
});
