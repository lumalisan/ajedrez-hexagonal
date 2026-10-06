const paths = {
  rules: 'M12 5C9 3 5 3 2 4v15c3-1 7-1 10 1m0-15c3-2 7-2 10-1v15c-3-1-7-1-10 1V5',
  tutorial: 'm2 8 10-5 10 5-10 5L2 8Zm4 3v6c4 3 8 3 12 0v-6m4-3v9',
  achievements:
    'M8 3h8v7a4 4 0 0 1-8 0V3Zm0 2H4v3a4 4 0 0 0 4 4m8-7h4v3a4 4 0 0 1-4 4m-4 2v6m-5 1h10',
  history: 'M3 11a9 9 0 1 1 2 7M3 4v7h7m2-4v6l4 2',
  ranking: 'M3 21V13h6v8m0 0V4h6v17m0 0V9h6v12',
  dilemma: 'm12 2 9 5v10l-9 5-9-5V7l9-5Zm0 5v5m0 0-5 4m5-4 5 4',
};

export function MenuIcon({ kind }: { kind: keyof typeof paths }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.6"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d={paths[kind]} />
    </svg>
  );
}
