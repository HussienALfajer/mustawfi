import type { ReactNode } from "react";
import { Dialog, Heading, Modal, ModalOverlay } from "react-aria-components";
import type { DensityName } from "../tokens/scale.ts";

export interface ModalDialogProps {
  readonly isOpen: boolean;
  /** Closed by `Esc` or a press outside: the caller decides what closing means. */
  readonly onOpenChange: (isOpen: boolean) => void;
  readonly title: string;
  readonly children: ReactNode;
  /** The density of its content; `touch` for what a POS or tablet opens (48 px targets). */
  readonly density?: DensityName;
}

/**
 * A dialog over the screen for a short task that must finish or be cancelled before the screen
 * goes on — the supervisor override over the POS — never a record (records open in a side
 * panel), and never a dialog over a dialog. Focus moves into it and back on close; `Esc`
 * cancels. The content brings its own actions.
 */
export function ModalDialog({ isOpen, onOpenChange, title, children, density }: ModalDialogProps) {
  return (
    <ModalOverlay
      isOpen={isOpen}
      onOpenChange={onOpenChange}
      isDismissable
      className="fixed inset-0 z-50 flex items-center justify-center bg-text/40 p-4"
    >
      <Modal className="max-h-full w-full max-w-2xl overflow-auto rounded-md bg-surface text-text shadow-floating">
        <Dialog className="outline-none">
          <div data-density={density} className="flex flex-col gap-4 p-6">
            <Heading slot="title" className="text-xl font-bold">
              {title}
            </Heading>
            {children}
          </div>
        </Dialog>
      </Modal>
    </ModalOverlay>
  );
}
