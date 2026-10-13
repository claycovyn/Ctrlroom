import { AddSquareIcon, ShareIcon } from "@/components/chat/icons";

/** How to add Ctrl Room to the Home Screen on iPhone or iPad (Apple only allows web notifications there). */
export function InstallSteps({ className = "" }: { className?: string }) {
  return (
    <ol className={`space-y-1.5 text-sm ${className}`}>
      <li className="flex items-center gap-2">
        <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-raised text-[11px] font-semibold">1</span>
        <span>
          In Safari, tap Share <ShareIcon className="inline h-4 w-4 align-[-3px]" />
        </span>
      </li>
      <li className="flex items-center gap-2">
        <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-raised text-[11px] font-semibold">2</span>
        <span>
          Choose Add to Home Screen <AddSquareIcon className="inline h-4 w-4 align-[-3px]" />
        </span>
      </li>
      <li className="flex items-center gap-2">
        <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-raised text-[11px] font-semibold">3</span>
        <span>Open Ctrl Room from your Home Screen and turn on notifications in Settings</span>
      </li>
    </ol>
  );
}
