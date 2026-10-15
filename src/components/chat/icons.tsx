// Small inline icons (stroke = currentColor) so there's no icon dependency.
type P = { className?: string };
const base = "h-4 w-4";
const svg = (d: React.ReactNode) =>
  function Icon({ className = base }: P) {
    return (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className={className} aria-hidden="true">
        {d}
      </svg>
    );
  };

export const HashIcon = svg(<path d="M4 9h16M4 15h16M10 3 8 21M16 3l-2 18" />);
export const VoiceIcon = svg(<><path d="M11 5 6 9H2v6h4l5 4V5Z" /><path d="M15.5 8.5a5 5 0 0 1 0 7M19 5a10 10 0 0 1 0 14" /></>);
export const MegaphoneIcon = svg(<><path d="m3 11 18-5v12L3 14v-3Z" /><path d="M11.6 16.8a3 3 0 1 1-5.8-1.6" /></>);
export const ThreadIcon = svg(<path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2Z" />);
export const PinIcon = svg(<><path d="M12 17v5" /><path d="M9 10.8V4h6v6.8l3 3.2v2H6v-2l3-3.2Z" /></>);
export const BoardIcon = svg(<><rect x="3" y="3" width="18" height="18" rx="2" /><path d="M3 9h18M9 21V9" /></>);
export const SearchIcon = svg(<><circle cx="11" cy="11" r="7" /><path d="m21 21-4.3-4.3" /></>);
export const UsersIcon = svg(<><path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2" /><circle cx="9" cy="7" r="4" /><path d="M22 21v-2a4 4 0 0 0-3-3.9M16 3.1a4 4 0 0 1 0 7.8" /></>);
export const PhoneIcon = svg(<><path d="m22 8-6 4 6 4V8Z" /><rect x="2" y="6" width="14" height="12" rx="2" /></>);
export const BellIcon = svg(<><path d="M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9" /><path d="M10.3 21a1.9 1.9 0 0 0 3.4 0" /></>);
export const BellOffIcon = svg(<><path d="M8.7 3A6 6 0 0 1 18 8a21 21 0 0 0 .6 5M17 17H3s3-2 3-9a4.7 4.7 0 0 1 .3-1.7" /><path d="M10.3 21a1.9 1.9 0 0 0 3.4 0M2 2l20 20" /></>);
export const SettingsIcon = svg(<><circle cx="12" cy="12" r="3" /><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1Z" /></>);
export const CloseIcon = svg(<path d="M18 6 6 18M6 6l12 12" />);
export const MenuIcon = svg(<path d="M4 6h16M4 12h16M4 18h16" />);
export const SmileIcon = svg(<><circle cx="12" cy="12" r="10" /><path d="M8 14s1.5 2 4 2 4-2 4-2M9 9h.01M15 9h.01" /></>);
export const EditIcon = svg(<path d="M17 3a2.8 2.8 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5Z" />);
export const TrashIcon = svg(<path d="M3 6h18M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />);
export const FlagIcon = svg(<><path d="M4 22V4" /><path d="M4 4h13l-2 4 2 4H4" /></>);
export const CheckIcon = svg(<path d="M20 6 9 17l-5-5" />);
export const SendIcon = svg(<path d="m22 2-7 20-4-9-9-4 20-7Z" />);
export const PlusIcon = svg(<path d="M12 5v14M5 12h14" />);
export const InfoIcon = svg(<><circle cx="12" cy="12" r="10" /><path d="M12 16v-4M12 8h.01" /></>);
export const ChevronDownIcon = svg(<path d="m6 9 6 6 6-6" />);
export const ArrowUpIcon = svg(<path d="M12 19V5M5 12l7-7 7 7" />);
export const ArrowDownIcon = svg(<path d="M12 5v14M19 12l-7 7-7-7" />);
export const MoreIcon = svg(<><circle cx="5" cy="12" r="1" /><circle cx="12" cy="12" r="1" /><circle cx="19" cy="12" r="1" /></>);
export const HeadsetIcon = svg(<><path d="M3 15v-3a9 9 0 0 1 18 0v3" /><path d="M21 16a2 2 0 0 1-2 2h-1v-6h1a2 2 0 0 1 2 2v2ZM3 16a2 2 0 0 0 2 2h1v-6H5a2 2 0 0 0-2 2v2Z" /></>);
export const VideoIcon = svg(<><path d="m22 8-6 4 6 4V8Z" /><rect x="2" y="6" width="14" height="12" rx="2" /></>);
export const MinusCircleIcon = svg(<><circle cx="12" cy="12" r="9" /><path d="M8 12h8" /></>);
/** The Feed: stacked posts. */
export const FeedIcon = svg(<><rect x="4" y="3" width="16" height="7" rx="2" /><rect x="4" y="14" width="16" height="7" rx="2" /></>);
export const ChatsIcon = svg(<><path d="M14 9a2 2 0 0 1-2 2H6l-3 3V4a2 2 0 0 1 2-2h7a2 2 0 0 1 2 2Z" /><path d="M18 9h1a2 2 0 0 1 2 2v10l-3-3h-6a2 2 0 0 1-2-2v-1" /></>);
export const BlockIcon = svg(<><circle cx="12" cy="12" r="9" /><path d="m5.6 5.6 12.8 12.8" /></>);
export const ArrowLeftIcon = svg(<path d="M19 12H5M12 19l-7-7 7-7" />);
export const PaperclipIcon = svg(<path d="m21.4 11.1-9.2 9.2a6 6 0 0 1-8.5-8.5l9.2-9.2a4 4 0 0 1 5.7 5.7l-9.2 9.2a2 2 0 0 1-2.8-2.8l8.5-8.5" />);
export const DownloadIcon = svg(<><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" /><path d="m7 10 5 5 5-5M12 15V3" /></>);
export const FileIcon = svg(<><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8Z" /><path d="M14 2v6h6" /></>);
export const FileTextIcon = svg(<><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8Z" /><path d="M14 2v6h6M8 13h8M8 17h5" /></>);
export const SheetIcon = svg(<><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8Z" /><path d="M14 2v6h6M8 12h8v6H8zM12 12v6M8 15h8" /></>);
export const SlidesIcon = svg(<><rect x="3" y="4" width="18" height="12" rx="2" /><path d="M12 16v4M8 20h8" /></>);
export const ArchiveIcon = svg(<><rect x="3" y="3" width="18" height="5" rx="1" /><path d="M5 8v11a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8M10 12h4" /></>);
export const AudioIcon = svg(<><path d="M9 18V5l12-2v13" /><circle cx="6" cy="18" r="3" /><circle cx="18" cy="16" r="3" /></>);
export const FilmIcon = svg(<><rect x="2" y="3" width="20" height="18" rx="2" /><path d="M7 3v18M17 3v18M2 9h5M2 15h5M17 9h5M17 15h5" /></>);
export const ImageIcon = svg(<><rect x="3" y="3" width="18" height="18" rx="2" /><circle cx="9" cy="9" r="2" /><path d="m21 15-3.1-3.1a2 2 0 0 0-2.8 0L6 21" /></>);
export const ChevronLeftIcon = svg(<path d="m15 18-6-6 6-6" />);
export const ChevronRightIcon = svg(<path d="m9 18 6-6-6-6" />);
export const RetryIcon = svg(<><path d="M21 12a9 9 0 1 1-3-6.7L21 8" /><path d="M21 3v5h-5" /></>);
// iOS Share (square with an arrow up) and Add to Home Screen (square with a plus): for the install steps.
export const ShareIcon = svg(<><path d="M12 3v12M8 7l4-4 4 4" /><path d="M6 11H5a1 1 0 0 0-1 1v8a1 1 0 0 0 1 1h14a1 1 0 0 0 1-1v-8a1 1 0 0 0-1-1h-1" /></>);
export const AddSquareIcon = svg(<><rect x="3" y="3" width="18" height="18" rx="4" /><path d="M12 8v8M8 12h8" /></>);
export const UserPlusIcon = svg(<><path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2" /><circle cx="9" cy="7" r="4" /><path d="M19 8v6M22 11h-6" /></>);
// The signed-in shell's rail and tab bar.
export const HomeIcon = svg(<><path d="M3 10.5 12 3l9 7.5" /><path d="M5 9v11a1 1 0 0 0 1 1h4v-6h4v6h4a1 1 0 0 0 1-1V9" /></>);
export const CompassIcon = svg(<><circle cx="12" cy="12" r="9" /><path d="m15.5 8.5-2 5-5 2 2-5 5-2Z" /></>);
export const UserIcon = svg(<><circle cx="12" cy="8" r="4" /><path d="M4 21v-1a7 7 0 0 1 14 0v1" /></>);
/** Communities: the hex from the mark. */
export const HexIcon = svg(<><path d="M12 2.5 20.5 7.3v9.4L12 21.5l-8.5-4.8V7.3Z" /><path d="M9 9.5h6M9 13h6M9 16.5h3.5" /></>);
export const FeatherIcon = svg(<><path d="M20 4c-7 0-12 5-12 12v4" /><path d="M8 16c5 0 9-3 10-8M4 20l4-4" /></>);
export const HeartIcon = svg(<path d="M19.5 13.6 12 21l-7.5-7.4A5 5 0 1 1 12 6.6a5 5 0 1 1 7.5 7Z" />);
export const ReplyIcon = svg(<path d="M21 12a8 8 0 0 1-11.6 7.1L4 20.5l1.4-4.6A8 8 0 1 1 21 12Z" />);
