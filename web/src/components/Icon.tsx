// A handful of hand-drawn 24px stroke icons; cheaper than an icon library.
const P: Record<string, React.ReactNode> = {
  phone: <path d="M5 4h3.5l1.6 4-2.1 1.4a11 11 0 0 0 6.6 6.6l1.4-2.1 4 1.6V19a1.5 1.5 0 0 1-1.6 1.5A16 16 0 0 1 3.5 5.6 1.5 1.5 0 0 1 5 4Z" />,
  'phone-down': (
    <path d="M3.2 14.6c-.6-.6-.6-1.6.1-2.1C5.6 10.6 8.7 9.5 12 9.5s6.4 1.1 8.7 3c.7.5.7 1.5.1 2.1l-1.6 1.6c-.5.5-1.3.6-1.9.2l-2-1.3c-.4-.3-.6-.7-.6-1.2v-1.6a12 12 0 0 0-5.4 0v1.6c0 .5-.2.9-.6 1.2l-2 1.3c-.6.4-1.4.3-1.9-.2Z" />
  ),
  mic: (
    <>
      <rect x="9" y="3" width="6" height="11" rx="3" />
      <path d="M5.5 11a6.5 6.5 0 0 0 13 0M12 17.5V21" />
    </>
  ),
  'mic-off': (
    <>
      <path d="M15 10V6a3 3 0 0 0-5.8-1M9 9v2a3 3 0 0 0 4.6 2.5M5.5 11a6.5 6.5 0 0 0 10.7 5M18.4 12.5c.1-.5.1-1 .1-1.5M12 17.5V21M4 4l16 16" />
    </>
  ),
  keypad: (
    <>
      {[6, 12, 18].flatMap((x) => [5, 11, 17].map((y) => <circle key={`${x}${y}`} cx={x} cy={y} r="1.2" />))}
      <circle cx="12" cy="22" r="1.2" />
    </>
  ),
  signal: (
    <>
      <path d="M4 18v-2M9 18v-5M14 18V9M19 18V5" strokeWidth="2.6" />
    </>
  ),
  battery: (
    <>
      <rect x="2.5" y="7" width="17" height="10" rx="2.5" />
      <rect x="4.5" y="9" width="11" height="6" rx="1" fill="currentColor" stroke="none" />
      <path d="M21.5 10.5v3" />
    </>
  ),
  bolt: <path d="M13 3 5 13.5h6L10 21l8-10.5h-6L13 3Z" />,
  check: <path d="m5 12.5 4.5 4.5L19 7.5" />,
  x: <path d="m6 6 12 12M18 6 6 18" />,
}

export function Icon({ name, size = 20 }: { name: keyof typeof P | string; size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.7"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      {P[name]}
    </svg>
  )
}
