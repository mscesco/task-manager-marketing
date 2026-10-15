// Spec 058 (15/10) -- o filtro de período: atalhos, personalizado e as setas.
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import PeriodPicker from "@/components/PeriodPicker";

afterEach(cleanup);

const HOJE = "2026-10-14";

describe("PeriodPicker", () => {
  it("o atalho escolhe o período e fecha", () => {
    const onChange = vi.fn();
    render(<PeriodPicker value={null} today={HOJE} onChange={onChange} />);
    fireEvent.click(screen.getByRole("button", { name: "Período: Agora" }));
    fireEvent.click(screen.getByRole("button", { name: /Semana passada/ }));
    expect(onChange).toHaveBeenCalledWith({ start: "2026-10-05", end: "2026-10-11" });
    expect(screen.queryByRole("dialog", { name: "Período" })).toBeNull();
  });

  it("personalizado recusa fim antes do início, e aplica o que vale", () => {
    const onChange = vi.fn();
    render(<PeriodPicker value={null} today={HOJE} onChange={onChange} />);
    fireEvent.click(screen.getByRole("button", { name: "Período: Agora" }));
    fireEvent.change(screen.getByLabelText("De"), { target: { value: "2026-10-05" } });
    fireEvent.change(screen.getByLabelText("Até"), { target: { value: "2026-10-01" } });
    fireEvent.click(screen.getByRole("button", { name: "Aplicar" }));
    expect(screen.getByRole("alert").textContent).toContain("antes do início");
    expect(onChange).not.toHaveBeenCalled();
    fireEvent.change(screen.getByLabelText("Até"), { target: { value: "2026-10-09" } });
    fireEvent.click(screen.getByRole("button", { name: "Aplicar" }));
    expect(onChange).toHaveBeenCalledWith({ start: "2026-10-05", end: "2026-10-09" });
  });

  it("as setas só aparecem com período, e andam o período inteiro", () => {
    const onChange = vi.fn();
    const { rerender } = render(<PeriodPicker value={null} today={HOJE} onChange={onChange} />);
    expect(screen.queryByRole("button", { name: "Período anterior" })).toBeNull();
    rerender(
      <PeriodPicker value={{ start: "2026-10-12", end: "2026-10-18" }} today={HOJE} onChange={onChange} />
    );
    expect(screen.getByRole("button", { name: "Período: Esta semana" })).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Período anterior" }));
    expect(onChange).toHaveBeenCalledWith({ start: "2026-10-05", end: "2026-10-11" });
  });
});
