import type { ReactNode } from 'react';

/** Square, resolution-independent emblems, shared by the collection and unlock notices. */
export function AchievementIcon({ icon, unlocked = true }: { icon: string; unlocked?: boolean }) {
  const academy =
    icon.startsWith('academy') || icon === 'tutorial-complete' || icon === 'daily-first';
  const tactical = [
    'captures-1',
    'captures-25',
    'captures-100',
    'conversion',
    'interception',
    'transformation',
    'clean-sweep',
    'untouchable',
    'comeback',
  ].includes(icon);
  return (
    <svg
      className={`achievement-icon${unlocked ? '' : ' is-locked'}`}
      data-palette={academy ? 'academy' : tactical ? 'tactics' : 'matches'}
      viewBox="0 0 96 96"
      width="96"
      height="96"
      aria-hidden="true"
      focusable="false"
    >
      <rect className="achievement-icon-base" x="1" y="1" width="94" height="94" rx="12" />
      <path className="achievement-icon-inset" d="m48 8 35 20v40L48 88 13 68V28Z" />
      <path className="achievement-icon-frame" d="m21 25 27-15 27 15M21 71l27 15 27-15" />
      <g className="achievement-icon-mark" strokeLinecap="round" strokeLinejoin="round">
        <Emblem icon={icon} />
      </g>
    </svg>
  );
}

function Emblem({ icon }: { icon: string }): ReactNode {
  if (icon.startsWith('ai-')) {
    const rank = ['ai-recruit', 'ai-tactical', 'ai-commander', 'ai-expert'].indexOf(icon) + 1;
    return (
      <>
        <path d="M28 30h40v30H28zM22 40h6m40 0h6M48 20v10" />
        <circle cx="48" cy="18" r="3" className="achievement-icon-solid" />
        <path d="M37 42h3m16 0h3M39 52h18" />
        {Array.from({ length: rank }, (_, index) => (
          <path
            key={index}
            className="achievement-icon-solid"
            d={`m${48 - (rank - 1) * 6 + index * 12} 67 3 4-3 4-3-4Z`}
          />
        ))}
        {rank === 4 && <path d="m28 30-3-12 12 7 11-10 11 10 12-7-3 12" />}
      </>
    );
  }
  if (icon.startsWith('clock-')) {
    return (
      <>
        <circle cx="48" cy="50" r="25" />
        <path d="M42 16h12m-6 0v9m20 5 5-5M48 30v5m-20 15h5m30 0h5M33 31l-5-5" />
        <text x="48" y="59" className="achievement-icon-number">
          {icon.slice(6)}
        </text>
        <path d="m42 69 4 4 8-8" />
      </>
    );
  }
  if (icon.startsWith('captures-')) {
    return (
      <>
        <path d="m27 24 22 22M24 30l7-7 4 4m34-3L47 46m25-16-7-7-4 4M32 61l-9 9m41-9 9 9" />
        <path d="m48 35 18 10v20L48 76 30 65V45Z" className="achievement-icon-field" />
        <text x="48" y="62" className="achievement-icon-number">
          {icon.slice(9)}
        </text>
      </>
    );
  }
  switch (icon) {
    case 'first-match':
      return (
        <>
          <path d="M31 74V23m1 1 19-5 17 10-17 10-19-5" />
          <path className="achievement-icon-solid" d="m43 28 7-2 8 4-8 3-7-2Z" />
          <path d="M22 74h40m-2-19 7 7 11-15" />
        </>
      );
    case 'local-match':
      return (
        <>
          <circle cx="32" cy="33" r="9" />
          <circle cx="64" cy="33" r="9" />
          <path d="M18 64V54a14 14 0 0 1 24-10m12 0a14 14 0 0 1 24 10v10M38 56h20m-14-6-6 6 6 6m8-12 6 6-6 6M23 70h50" />
        </>
      );
    case 'local-win':
      return (
        <>
          <path d="M32 48V27a5 5 0 0 1 10 0v17-25a5 5 0 0 1 10 0v25-20a5 5 0 0 1 10 0v22-12a5 5 0 0 1 10 0v22L60 73H39L25 55a6 6 0 0 1 7-7Z" />
          <path d="m18 33-5-3m8-10-3-6m59 3 4-5M41 64h15" />
        </>
      );
    case 'first-win':
    case 'wins-10':
      return (
        <>
          <path d="M32 25h32v13a16 16 0 0 1-32 0Zm0 3H21v9c0 9 7 13 15 13m28-22h11v9c0 9-7 13-15 13M48 54v16M35 73h26" />
          {icon === 'wins-10' ? (
            <text x="48" y="43" className="achievement-icon-small-number">
              10
            </text>
          ) : (
            <path
              className="achievement-icon-solid"
              d="m48 30 3 6 7 1-5 5 1 6-6-3-6 3 1-6-5-5 7-1Z"
            />
          )}
        </>
      );
    case 'matches-10':
    case 'matches-50':
      return (
        <>
          <path d="m36 57-5 23 17-9 17 9-5-23" className="achievement-icon-field" />
          <path d="m48 15 9 5 10 1 3 10 6 8-6 9-3 10-10 1-9 5-9-5-10-1-3-10-6-9 6-8 3-10 10-1Z" />
          <text x="48" y="47" className="achievement-icon-number">
            {icon.slice(8)}
          </text>
        </>
      );
    case 'academy-first':
      return (
        <>
          <path d="M48 31c-8-6-18-8-29-6v39c11-2 21 0 29 6 8-6 18-8 29-6V25c-11-2-21 0-29 6Zm0 0v39M27 38l12 3m-12 7 12 3m18-10 12-3m-12 13 12-3" />
        </>
      );
    case 'tutorial-complete':
      return (
        <>
          <path d="m17 35 31-15 31 15-31 15Zm12 6v19c13 10 25 10 38 0V41M79 35v23" />
          <path d="m38 59 7 7 15-17M77 58h4v10h-4" />
        </>
      );
    case 'academy-complete':
      return (
        <>
          <path d="M27 19h42v43H27zM36 30h24m-24 9h17m-17 9h12" />
          <circle cx="57" cy="58" r="13" className="achievement-icon-field" />
          <path d="m48 69-3 12 12-5 12 5-3-12m-15-12 4 4 8-8" />
        </>
      );
    case 'daily-first':
      return (
        <>
          <path d="M23 29h50v43H23zM23 40h50M34 21v15m28-15v15" />
          <path className="achievement-icon-solid" d="m50 44-13 16h10l-3 12 16-20H49l4-8Z" />
        </>
      );
    case 'academy-gold':
      return (
        <>
          <path d="m29 17 19 22 19-22M39 17l9 11 9-11" />
          <circle cx="48" cy="56" r="23" />
          <path
            className="achievement-icon-solid"
            d="m48 40 4 10 12 1-9 8 3 12-10-7-10 7 3-12-9-8 12-1Z"
          />
        </>
      );
    case 'conversion':
      return (
        <>
          <path d="M24 40a25 25 0 0 1 42-15l7 8m-1-13 1 13-13-1M72 56a25 25 0 0 1-42 15l-7-8m1 13-1-13 13 1" />
          <path className="achievement-icon-field" d="m48 34 12 7v14l-12 7-12-7V41Z" />
          <path d="M48 41v14m-7-7h14" />
        </>
      );
    case 'interception':
      return (
        <>
          <path d="m22 43 26-10 26 10-4 18-22 17-22-17Z" />
          <path d="M48 69V47m-9 10 9-10 9 10m-9-10V19m0 0L32 29l16-4 16 4-16-10" />
          <path d="m23 21 6 6m44-6-6 6" />
        </>
      );
    case 'transformation':
      return (
        <>
          <path d="M17 31h32v17H17zm8-8h17v8M13 48h40" />
          <circle cx="24" cy="51" r="4" />
          <circle cx="44" cy="51" r="4" />
          <path d="M60 30h12v17m-6-6 6 6 6-6" />
          <circle cx="65" cy="58" r="7" />
          <path d="M53 78v-6a12 12 0 0 1 24 0v6Zm-29-9h17m-6-6 6 6-6 6" />
        </>
      );
    case 'clean-sweep':
      return (
        <>
          <path d="m61 19-18 31M35 45l23 13-12 23-29-17ZM30 61l-6 8m15-3-6 9m15-4-4 6M65 42v12m-6-6h12M77 61v8m-4-4h8M23 26v10m-5-5h10" />
        </>
      );
    case 'untouchable':
      return (
        <>
          <path d="m48 17 28 11-5 31-23 21-23-21-5-31Z" />
          <path className="achievement-icon-field" d="M34 59V35h8v8h12v-8h8v24Z" />
          <path d="M48 50v9m-9 0h18m-7-35 3 3 6-6" />
        </>
      );
    case 'comeback':
      return (
        <>
          <path d="M24 61h14V49h14V36h18M57 23l13 13-13 13" />
          <path className="achievement-icon-solid" d="m35 72 5-5 5 5-5 6Z" />
          <path d="M22 28c0-9 13-10 17-3 4-7 17-6 17 3 0 8-17 17-17 17S22 36 22 28Z" />
        </>
      );
    default:
      return <path d="m48 23 7 16 18 2-14 13 4 19-15-10-15 10 4-19-14-13 18-2Z" />;
  }
}

export function AchievementsMenuIcon() {
  return (
    <svg className="toolbar-icon" viewBox="0 0 24 24" aria-hidden="true" focusable="false">
      <path d="M7 3h10v5a5 5 0 0 1-10 0Zm0 2H3v3a4 4 0 0 0 5 4m9-7h4v3a4 4 0 0 1-5 4m-4 1v6m-4 2h8" />
    </svg>
  );
}
