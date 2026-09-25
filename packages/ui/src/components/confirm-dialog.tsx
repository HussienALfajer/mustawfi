import type { ReactNode } from "react";
import { Dialog, Heading, Modal, ModalOverlay } from "react-aria-components";
import { Button } from "./button.tsx";

export interface ConfirmDialogProps {
  readonly isOpen: boolean;
  readonly onOpenChange: (isOpen: boolean) => void;
  readonly title: string;
  readonly children: ReactNode;
  readonly confirmLabel: string;
  readonly cancelLabel: string;
  readonly onConfirm: () => void;
  readonly isPending?: boolean;
}

/**
 * The one confirmation a destructive or security action asks for (archive, revoke, deactivate),
 * never a routine one. Focus starts on Cancel, so a stray Enter does not destroy anything;
 * `Esc` cancels.
 */
export function ConfirmDialog({
  isOpen,
  onOpenChange,
  title,
  children,
  confirmLabel,
  cancelLabel,
  onConfirm,
  isPending = false,
}: ConfirmDialogProps) {
  return (
    <ModalOverlay
      isOpen={isOpen}
      onOpenChange={onOpenChange}
      isDismissable
      className="fixed inset-0 z-50 flex items-center justify-center bg-text/40 p-4"
    >
      <Modal className="w-full max-w-md rounded-md bg-surface text-text shadow-floating">
        <Dialog role="alertdialog" className="flex flex-col gap-4 p-5 outline-none">
          <Heading slot="title" className="text-lg font-semibold">
            {title}
          </Heading>
          <div className="text-text-secondary">{children}</div>
          <div className="flex gap-2">
            <Button variant="danger" onPress={onConfirm} isPending={isPending}>
              {confirmLabel}
            </Button>
            <Button
              variant="secondary"
              autoFocus
              onPress={() => {
                onOpenChange(false);
              }}
            >
              {cancelLabel}
            </Button>
          </div>
        </Dialog>
      </Modal>
    </ModalOverlay>
  );
}
