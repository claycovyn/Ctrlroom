/* eslint-disable @next/next/no-img-element */

/** The Ctrl Room app icon (carries its own black tile, so it works on any background). */
export function LogoMark({ className = "h-7 w-7" }: { className?: string }) {
  return <img src="/brand/ctrlroom-icon-192.png" alt="" className={className} width={192} height={192} />;
}

/** "CTRL ROOM by OpenCtrl" lockup, swapped for light and dark backgrounds. */
export function Logo({ className = "h-8 w-auto" }: { className?: string }) {
  return (
    <span className="inline-flex">
      <img src="/brand/ctrlroom-lockup-on-light.png" alt="Ctrl Room by OpenCtrl" className={`${className} dark:hidden`} width={1341} height={260} />
      <img src="/brand/ctrlroom-lockup-on-dark.png" alt="Ctrl Room by OpenCtrl" className={`hidden ${className} dark:block`} width={1341} height={260} />
    </span>
  );
}
