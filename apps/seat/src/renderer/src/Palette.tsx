import type { ItemState, SyncView } from '../../shared/ipc.ts';
import { displayState, legendCounts, PALETTE_STATES, tickOf } from './exam-state.ts';
import type { Strings } from './i18n.ts';

interface Props { order: readonly string[]; items: Record<string, ItemState>; visited: ReadonlySet<string>; current: number; sync: SyncView; t: Strings; onPick: (i: number) => void }

export function Palette({ order, items, visited, current, sync, t, onPick }: Props) {
  const counts = legendCounts(order, items, visited);
  return (
    <nav className="palette" aria-label={t.palette}>
      <h2 className="palette-title">{t.palette}</h2>
      <ol className="grid">
        {order.map((id, i) => {
          const s = displayState(items, visited, id);
          const tick = tickOf(items[id]?.seq ?? 0, sync);
          return (
            <li key={id}>
              <button
                className={`pal ${s}${i === current ? ' current' : ''}`}
                aria-current={i === current ? 'step' : undefined}
                aria-label={`${t.question} ${i + 1}: ${t.state[s]}${tick === 'none' ? '' : `, ${t.tick[tick]}`}`}
                onClick={() => onPick(i)}
              >{i + 1}</button>
            </li>
          );
        })}
      </ol>
      <ul className="legend">
        {PALETTE_STATES.map((s) => (
          <li key={s}><span className={`pal ${s} mini`} aria-hidden="true">{counts[s]}</span>{t.state[s]}<span className="sr-only">: {counts[s]}</span></li>
        ))}
      </ul>
    </nav>
  );
}
