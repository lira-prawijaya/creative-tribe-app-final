import React, { useEffect, useRef, useState } from 'react';
import { Check, ChevronDown } from 'lucide-react';
import {
  STATUS_WARNA_DISPLAY_META,
  STATUS_WARNA_DROPDOWN_OPTIONS,
  StatusColorKey,
} from '../types/statusWarna';

interface StatusWarnaDropdownProps {
  value: StatusColorKey;
  onSelect: (nextColor: 'green' | 'red') => void;
  disabled?: boolean;
  ariaLabel?: string;
  compact?: boolean;
}

export const StatusWarnaDropdown: React.FC<StatusWarnaDropdownProps> = ({
  value,
  onSelect,
  disabled = false,
  ariaLabel = 'Status Warna',
  compact = false,
}) => {
  const [open, setOpen] = useState(false);
  const [menuPos, setMenuPos] = useState<{ top: number; left: number; width: number }>({
    top: 0,
    left: 0,
    width: 196,
  });
  const triggerRef = useRef<HTMLButtonElement | null>(null);
  const menuRef = useRef<HTMLDivElement | null>(null);

  const displayMeta = STATUS_WARNA_DISPLAY_META[value] ?? STATUS_WARNA_DISPLAY_META.white;

  const updateMenuPosition = () => {
    const btn = triggerRef.current;
    if (!btn) return;
    const rect = btn.getBoundingClientRect();
    const menuWidth = Math.max(196, rect.width);
    const estimatedMenuHeight = 96;
    const openUpward =
      rect.bottom + estimatedMenuHeight > window.innerHeight - 12 &&
      rect.top > estimatedMenuHeight + 12;
    const top = openUpward
      ? Math.max(8, rect.top - estimatedMenuHeight - 4)
      : Math.min(window.innerHeight - estimatedMenuHeight - 8, rect.bottom + 4);
    const left = Math.min(
      Math.max(8, rect.left),
      Math.max(8, window.innerWidth - menuWidth - 8)
    );
    setMenuPos({ top, left, width: menuWidth });
  };

  useEffect(() => {
    if (!open) return;
    updateMenuPosition();

    const handlePointerDown = (ev: MouseEvent) => {
      const target = ev.target as Node | null;
      if (!target) return;
      if (triggerRef.current?.contains(target) || menuRef.current?.contains(target)) {
        return;
      }
      setOpen(false);
    };

    const handleKeyDown = (ev: KeyboardEvent) => {
      if (ev.key === 'Escape') {
        setOpen(false);
      }
    };

    const handleScrollOrResize = () => {
      updateMenuPosition();
    };

    document.addEventListener('mousedown', handlePointerDown);
    document.addEventListener('keydown', handleKeyDown);
    window.addEventListener('scroll', handleScrollOrResize, true);
    window.addEventListener('resize', handleScrollOrResize);
    return () => {
      document.removeEventListener('mousedown', handlePointerDown);
      document.removeEventListener('keydown', handleKeyDown);
      window.removeEventListener('scroll', handleScrollOrResize, true);
      window.removeEventListener('resize', handleScrollOrResize);
    };
  }, [open]);

  return (
    <div className="relative inline-block text-left">
      <button
        ref={triggerRef}
        type="button"
        disabled={disabled}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-label={ariaLabel}
        onClick={() => {
          if (disabled) return;
          setOpen((prev) => !prev);
        }}
        className={`inline-flex items-center justify-between gap-2 border rounded-md font-semibold transition-colors focus:outline-none focus:ring-2 focus:ring-slate-900 whitespace-nowrap ${
          compact ? 'px-2 py-1 text-[11px] min-w-[144px]' : 'px-2.5 py-1.5 text-xs min-w-[162px]'
        } ${
          disabled ? 'opacity-60 cursor-not-allowed' : 'cursor-pointer hover:brightness-95'
        } ${displayMeta.badgeClass}`}
      >
        <span className="inline-flex items-center gap-1.5">
          <span className={`w-2 h-2 rounded-full shrink-0 ${displayMeta.dotClass}`} />
          <span>{displayMeta.label}</span>
        </span>
        <ChevronDown className="w-3.5 h-3.5 shrink-0 opacity-70" />
      </button>

      {open && !disabled && (
        <div
          ref={menuRef}
          role="listbox"
          aria-label={ariaLabel}
          style={{
            position: 'fixed',
            top: `${menuPos.top}px`,
            left: `${menuPos.left}px`,
            minWidth: `${menuPos.width}px`,
            zIndex: 80,
          }}
          className="bg-white border border-slate-200 rounded-lg shadow-xl py-1 overflow-hidden"
        >
          {STATUS_WARNA_DROPDOWN_OPTIONS.map((opt) => {
            const isSelected = value === opt.color;
            return (
              <button
                key={opt.color}
                type="button"
                role="option"
                aria-selected={isSelected}
                onClick={() => {
                  setOpen(false);
                  onSelect(opt.color);
                }}
                className={`w-full px-3 py-2 text-left text-xs font-semibold flex items-center justify-between gap-2 transition-colors cursor-pointer ${opt.itemClass}`}
              >
                <span className="inline-flex items-center gap-2">
                  <span className={`w-2.5 h-2.5 rounded-full shrink-0 ${opt.dotClass}`} />
                  <span>{opt.label}</span>
                </span>
                {isSelected && <Check className="w-3.5 h-3.5 shrink-0 opacity-80" />}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
};
