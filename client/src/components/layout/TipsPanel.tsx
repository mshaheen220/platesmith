import { useEffect, useState } from 'react';
import { Layers, Printer, Lightbulb, ChevronLeft, ChevronRight, Pause, Play, X } from 'lucide-react';
import { shuffleIndices, TIPS, type TipCategory } from '../../tips';

const CATEGORY_LABELS: Record<TipCategory, string> = {
  layers: 'Layers',
  printing: 'Printing',
  backlight: 'Backlight & Viewing',
};

const CATEGORY_ICONS: Record<TipCategory, typeof Layers> = {
  layers: Layers,
  printing: Printer,
  backlight: Lightbulb,
};

const CATEGORY_BADGE_STYLES: Record<TipCategory, string> = {
  layers: 'border-blue-700/60 bg-blue-900/50 text-blue-200',
  printing: 'border-green-700/60 bg-green-900/50 text-green-200',
  backlight: 'border-amber-700/60 bg-amber-900/50 text-amber-200',
};

const AUTOPLAY_INTERVAL_MS = 6000;

export function TipsPanel() {
  const [isOpen, setIsOpen] = useState(true);
  const [order, setOrder] = useState<number[]>(() => shuffleIndices(TIPS.length));
  const [position, setPosition] = useState(0);
  const [autoplay, setAutoplay] = useState(true);

  const currentTip = TIPS[order[position]];
  const CategoryIcon = CATEGORY_ICONS[currentTip.category];

  const goNext = () => {
    setPosition((p) => {
      if (p + 1 >= order.length) {
        // Full tour complete - reshuffle for the next lap rather than
        // looping the same order, so it doesn't feel mechanically repetitive.
        setOrder(shuffleIndices(TIPS.length));
        return 0;
      }
      return p + 1;
    });
  };

  const goPrev = () => {
    setPosition((p) => (p - 1 + order.length) % order.length);
  };

  useEffect(() => {
    // Collapsing shouldn't leave the interval quietly advancing a tip
    // nobody can see - pause while closed, resume from wherever it left
    // off once reopened (the autoplay toggle itself is untouched).
    if (!autoplay || !isOpen) return;
    const timer = setInterval(goNext, AUTOPLAY_INTERVAL_MS);
    return () => clearInterval(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [autoplay, isOpen, order]);

  if (!isOpen) {
    return (
      <button
        type="button"
        onClick={() => setIsOpen(true)}
        className="flex shrink-0 items-center gap-1.5 rounded-md border border-gray-700 bg-gray-900/60 px-3 py-1.5 text-xs font-medium text-gray-300 transition-colors hover:border-gray-500 hover:text-white"
      >
        <Lightbulb size={14} /> Tips
      </button>
    );
  }

  return (
    <div className="flex w-full min-w-0 items-center gap-3 rounded-lg border border-gray-700 bg-gray-900/60 py-2 pl-3 pr-2">
      <span
        title={CATEGORY_LABELS[currentTip.category]}
        className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-full border text-sm ${CATEGORY_BADGE_STYLES[currentTip.category]}`}
      >
        <CategoryIcon size={14} aria-hidden />
        <span className="sr-only">{CATEGORY_LABELS[currentTip.category]}</span>
      </span>

      {/* min-h reserves space for a full 2 lines (text-xs/leading-relaxed)
          so a short 1-line tip doesn't shrink the bar and shift the header;
          items-center then keeps a short tip vertically centered in that
          reserved space instead of stuck at the top. */}
      <div className="flex min-h-[2.5rem] min-w-0 flex-1 items-center">
        <p key={order[position]} className="line-clamp-2 animate-fade-in text-xs leading-relaxed text-gray-300">
          {currentTip.text}
        </p>
      </div>

      <div className="flex shrink-0 items-center gap-1">
        <button
          type="button"
          onClick={goPrev}
          aria-label="Previous tip"
          className="rounded p-1.5 text-gray-400 transition-colors hover:bg-gray-700 hover:text-white"
        >
          <ChevronLeft size={14} />
        </button>
        <button
          type="button"
          onClick={goNext}
          aria-label="Next tip"
          className="rounded p-1.5 text-gray-400 transition-colors hover:bg-gray-700 hover:text-white"
        >
          <ChevronRight size={14} />
        </button>
        <button
          type="button"
          onClick={() => setAutoplay((a) => !a)}
          aria-pressed={autoplay}
          title={autoplay ? 'Stop autoplay' : 'Autoplay through tips'}
          className={`rounded p-1.5 transition-colors ${
            autoplay ? 'bg-blue-600 text-white' : 'text-gray-400 hover:bg-gray-700 hover:text-white'
          }`}
        >
          {autoplay ? <Pause size={12} /> : <Play size={12} />}
        </button>
        <button
          type="button"
          onClick={() => setIsOpen(false)}
          aria-label="Collapse tips"
          className="rounded p-1.5 text-gray-400 transition-colors hover:bg-gray-700 hover:text-white"
        >
          <X size={14} />
        </button>
      </div>
    </div>
  );
}
