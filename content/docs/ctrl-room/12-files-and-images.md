---
title: Files and images
description: Send photos and files in rooms, threads and direct messages. Limits, types, privacy and deleting.
---

# Files and images

You can attach photos and files to messages in rooms, thread replies and direct messages.

## Attach files

- Click the **paperclip** next to the message box, **paste** an image, or **drag files** onto the message box.
- Each file shows its progress. Click **×** to cancel or remove it. If an upload fails, click **Retry**.
- For an image, click **Add description** to write what it shows. Screen readers read it aloud. Without one, it's just "Image".
- Send when the uploads finish. A message can be only files, with no text.

Files can't be added to the first message of a new direct message. Send the first message, then attach files in the conversation.

## Limits

- Up to **10 MB** per file and **10 files** per message.
- Photos (PNG, JPEG, WebP) are shrunk in your browser before upload: the long edge is at most 2,560 pixels, saved as WebP. This also removes location and camera details. GIFs are sent as they are, so they must be 10 MB or less.
- In direct messages, each person can keep up to **500 MB** of files in total. Delete messages with files to free space.
- At most 30 files waiting to send at once, and 200 new files an hour.

## Types you can send

| Kind | Types |
| --- | --- |
| Images | PNG, JPEG, WebP, GIF |
| Documents | PDF, Word (.docx), Excel (.xlsx), PowerPoint (.pptx) |
| Text | Plain text (.txt), Markdown (.md), CSV |
| Archives | ZIP |
| Audio | MP3, M4A, Ogg, WAV |
| Video | MP4, WebM (up to 10 MB) |

SVG and HTML files can't be sent, because they can run code in a browser.

## Viewing and downloading

Images show in the message, side by side when there are several. Tap one to open it full screen. Use the arrows, swipe, or the arrow keys to move between images, pinch to zoom, and press **Esc** to close. Other files show as a card with their name and size, and a **Download** button.

## Who can see files

Files are private. Only people who can read the message can open its files:

- **Rooms**: members of the community.
- **Direct messages**: the people in the conversation. If you leave a group, you keep the files sent before you left, and nothing after.

File links last one hour, so a copied link stops working after that.

## Deleting

Deleting a message deletes its files too. In rooms, mods and up can delete other people's messages and their files, as with any message. Files that were uploaded but never sent are removed after 24 hours.

## Export

A community export lists every file sent in it (name, type, size and storage path), not the files themselves.

## OpenCtrl Cloud

Files sent in a community are recorded for the community owner's workspace as a cost estimate only. There's no file limit on OpenCtrl Cloud beyond the per-file and per-message limits above. Direct messages don't count toward any community.

## Self-hosting

The `0013_attachments` migration creates a private Supabase Storage bucket named `attachments` with the size and type limits. The daily cron (`/api/cron/usage`) removes the files of deleted messages and unsent uploads. To change the 500 MB direct message limit:

```sql
alter database postgres set ctrlroom.dm_files_cap_mb = '1000';
```
