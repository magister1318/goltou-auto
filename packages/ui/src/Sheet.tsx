import { useEffect, useRef, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
export function Sheet({
  title,
  children,
  close,
  dismissible = true,
  centered = false,
  footer,
}: {
  title: string;
  children: ReactNode;
  close(): void;
  dismissible?: boolean;
  centered?: boolean;
  footer?: ReactNode;
}) {
  const ref = useRef<HTMLElement>(null);
  const closeRef = useRef(close);
  closeRef.current = dismissible ? close : () => {};
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    const app = document.querySelector('.app-body');
    const position = window.scrollY;
    const old = {
      position: document.body.style.position,
      top: document.body.style.top,
      width: document.body.style.width,
      overflow: document.documentElement.style.overflow,
    };
    document.body.style.position = 'fixed';
    document.body.style.top = `-${position}px`;
    document.body.style.width = '100%';
    document.documentElement.style.overflow = 'hidden';
    app?.setAttribute('inert', '');
    ref.current?.focus({ preventScroll: true });
    const key = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        closeRef.current();
      }
      if (event.key === 'Tab') {
        const controls = [
          ...ref.current!.querySelectorAll<HTMLElement>(
            'button:not(:disabled),input:not(:disabled),select:not(:disabled),textarea:not(:disabled)',
          ),
        ];
        const first = controls[0],
          last = controls[controls.length - 1];
        if (
          event.shiftKey &&
          (document.activeElement === first ||
            document.activeElement === ref.current)
        ) {
          event.preventDefault();
          last?.focus();
        } else if (
          !event.shiftKey &&
          (document.activeElement === last ||
            document.activeElement === ref.current)
        ) {
          event.preventDefault();
          first?.focus();
        }
      }
    };
    document.addEventListener('keydown', key);
    const back = () => closeRef.current();
    window.addEventListener('goltou:close-sheet', back);
    return () => {
      app?.removeAttribute('inert');
      document.removeEventListener('keydown', key);
      window.removeEventListener('goltou:close-sheet', back);
      Object.assign(document.body.style, {
        position: old.position,
        top: old.top,
        width: old.width,
      });
      document.documentElement.style.overflow = old.overflow;
      window.scrollTo(0, position);
      previous?.focus({ preventScroll: true });
    };
  }, []);
  const content = (
    <div
      className={centered ? 'dim centered-dialog' : 'dim'}
      onClick={(event) => {
        if (event.target === event.currentTarget) closeRef.current();
      }}
    >
      <section
        ref={ref}
        className={footer ? 'sheet sheet-with-footer' : 'sheet'}
        role="alertdialog"
        aria-modal="true"
        aria-label={title}
        tabIndex={-1}
      >
        <h2>{title}</h2>
        {footer ? <><div className="sheet-scroll">{children}</div><footer className="sheet-footer">{footer}</footer></> : children}
      </section>
    </div>
  );
  return typeof document === 'undefined'
    ? content
    : createPortal(content, document.body);
}
