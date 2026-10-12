import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import { ConfirmDialog } from "./Modal";

describe("ConfirmDialog", () => {
  it("is not rendered when closed", () => {
    render(<ConfirmDialog open={false} title="Borrar" message="¿Seguro?" onConfirm={vi.fn()} onCancel={vi.fn()} />);
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("confirms, cancels and closes with Escape", async () => {
    const onConfirm = vi.fn();
    const onCancel = vi.fn();
    const user = userEvent.setup();
    render(
      <ConfirmDialog open title="Desactivar" message="Se cerrarán sus sesiones." confirmLabel="Desactivar" onConfirm={onConfirm} onCancel={onCancel} />,
    );
    const dialog = screen.getByRole("dialog", { name: "Desactivar" });
    expect(dialog).toHaveTextContent("Se cerrarán sus sesiones.");
    // The confirm action receives initial focus.
    expect(screen.getByRole("button", { name: "Desactivar" })).toHaveFocus();

    await user.click(screen.getByRole("button", { name: "Desactivar" }));
    expect(onConfirm).toHaveBeenCalledTimes(1);
    await user.click(screen.getByRole("button", { name: "Cancelar" }));
    await user.keyboard("{Escape}");
    expect(onCancel).toHaveBeenCalledTimes(2);
  });

  it("blocks closing while loading", async () => {
    const onCancel = vi.fn();
    const user = userEvent.setup();
    render(<ConfirmDialog open loading title="X" message="..." onConfirm={vi.fn()} onCancel={onCancel} />);
    await user.keyboard("{Escape}");
    expect(onCancel).not.toHaveBeenCalled();
    expect(screen.getByRole("button", { name: "Cancelar" })).toBeDisabled();
  });
});
