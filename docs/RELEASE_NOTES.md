# Notible release notes

## 0.97.0

Core 0.97.0 · plugin API 1.28 · official plugins: Graph 0.11.7, Habits 0.9.2, Notifications 0.1.8, ReportIt 0.1.17, Sync 0.4.9, Sync Simple 0.5.10, Tables 0.7.1, Teams 0.1.3, Nib 0.2.2, Library 0.3.0, Note schemas 0.2.0.

### New

- **The MCP server is in the app again:** Settings → MCP server works in the installed app, because the server ships inside Notible. The download is larger: roughly 40 MB instead of 9 MB.
- **Code block look:** Settings → Appearance → **Code blocks** sets the code font size, line height, long lines (wrap, or scroll sideways) and tab width, apart from the text settings. It applies at once, is stored on this computer, and **Reset** brings back the usual look. Code comparison blocks follow the size, line height and tab width. Print keeps its own code look. (Hive #32)
- **Diagram colours:** Mermaid diagrams no longer sit on a white box in Midnight. The new default theme, **Notible**, draws them in the app's own colours and follows Daylight, Midnight and theme packs; groups (subgraphs) are no longer always blue. Settings → Plugins → Editor extensions → **Diagram appearance** adds colour pickers for the background, node fill, border and text, lines and arrows, and group fill and border (each on Auto until you pick one), and a live preview that redraws as you change them. Mermaid's own themes (Default, Neutral, Forest, Base) show on a soft panel in Midnight, with readable labels. A diagram's own front matter still wins. (Hive #41)

### Improved

- **Polish in Settings → Plugins:** when Notible is in Polish, the built-in plugins' names, their detail panes (the settings titles, the "For example" texts, the "Turn on first" line and the counts of places in the interface) and the names and descriptions of the **/** menu's commands are translated. The whiteboard's canvas gets its own Polish name everywhere. (Hive #51, #54, #58)

## 0.96.0

Core 0.96.0 · plugin API 1.28.

### New

- **Plugins can import images from the web:** plugin API 1.28 adds `context.data.media.importImageFromUrl(url)` and a `networkHosts` list in `plugin.json`. Core downloads the image itself and keeps it in Notible's media folder, so it works offline and syncs. It checks everything in Rust: https only, only the hosts the plugin declared (also after a redirect), no addresses inside your network, 15 seconds, 20 MB, and real PNG, JPEG, WebP or GIF content. The install dialog and the plugin's details now say which hosts a plugin talks to ("Talks to"). (Hive #45)
- **Format button on code blocks:** every code block now has a **Format** button next to **Copy**. It opens the code block tools (sort lines, remove duplicates, trim spaces, case, and JSON pretty print or minify in a `json` block) without a right-click, and works from the keyboard. (Hive #43)

## 0.95.1

Core 0.95.1 · plugin API 1.27.

### New

- **Code block tools:** right-click a code block, or type `/` inside one, to sort lines, remove duplicate lines, trim trailing spaces, join lines, turn tabs into spaces (and leading spaces into tabs), or change the case. A `json` block can also be pretty printed or minified. Each tool is one **Ctrl+Z** step. JSON that is invalid, has a key twice, holds an integer above 2^53−1, or holds a number that cannot be kept exactly is left as it is, with a notice. (Hive #35)
- **Library:** the official Library plugin keeps books, films, series and games with ratings, statuses, tags and covers, shows them as a grid or a list, and filters and sorts the collection. Plugin API 1.27 adds a safe image picker, `context.data.media.pickImage()`, behind the `media.write` permission: the user picks the file in a native dialog, and Core checks the format and the 20 MB limit. (Hive #30)
- **Note schemas:** the Note schemas plugin fills in new items of one kind with a title pattern (with a counter), properties and tags. A new schema's entry in the **+** menu now shows straight away, with no restart: Core refreshes the menu when a plugin adds a command after it loads. (Hive #31, #37)
- **Code comparison:** type `/` and pick **Code comparison** to add a `compare` block. Put the old code above a line of `=====` and the new code below it, and the two are shown side by side with line numbers and marks for added, removed and changed lines. On a narrow note the two panes stack. A block without the `=====` line says so. The block stays plain Markdown, so print and export keep its source. (Hive #33)
- **Diagram appearance:** Settings → Plugins → Editor extensions → **Diagram appearance** sets the Mermaid theme (Auto follows Notible's light or dark look, or Default, Neutral, Forest, Base), a hand-drawn look, and the ELK layout for larger diagrams. It is stored on this computer and applies in the editor, in print and in export. A diagram's own front matter still wins. (Hive #34)

### Improved

- **Settings → MCP server** (was **AI cleanup**): shows how to connect an AI assistant (a ready-to-copy setup for Claude Code, Codex or any other MCP client, the server's location, and whether Notible is open for it), and lists what a connected AI may and may not do. **Allow edits** remains on by default and **Include finance data** remains off. Access switches and cleanup scopes are edited in the panel; Rust requires a native Windows confirmation before any change widens access, including calls initiated by plugins. Turning access off needs no confirmation. The settings are stored on this computer only; client environment variables can only narrow access, and Notible's own AI remains propose-only. The note action is **Protect from AI**. MCP server 1.3.0. (Hive #29, #38)
- **Polish everywhere:** the official plugins now speak Polish when Notible does: Tables, Sync, Sync Simple, Graph, Habits, Notifications, ReportIt (including the report it makes), Teams and Nib. Also translated: the remaining Core and built-in labels, such as the kind label above a note ("Notatka"), Typewriter, Whiteboard and Automations texts, and the code block's "edit" hint. Plugin versions: Tables 0.7.1, Sync 0.4.8, Sync Simple 0.5.9, Graph 0.11.7, Habits 0.9.2, Notifications 0.1.8, ReportIt 0.1.17, Teams 0.1.3, Nib 0.2.3. (Hive #28)

### Fixed

- The Properties panel no longer undoes changes made while it was open. It saved its whole copy of an item's properties, so a value set meanwhile by a plugin, an automation or a sync from another computer was lost on your next edit. It now saves only the fields you changed and shows the current values when something else changes them. (Hive #36)

## 0.95.0

Core 0.95.0 · plugin API 1.26 · Notible Sync 0.4.7 · Sync Simple 0.5.8 · Notible Tables 0.7.0 · Notible Teams 0.1.2. Update the sync plugins on every computer.

### New

- **Resolve conflict view:** a sync conflict notice now opens one shared **Resolve conflict** screen. Go through the differences one by one and keep the current text, the saved version, or both, then save. A copy you have fully reviewed goes to the Trash, with **Undo**. If the note changed meanwhile, you are asked to review again; anything other than the text keeps its conflict copy. Plugins can open this screen with `context.ui.openSyncConflicts` (plugin API 1.26). (Hive #7)
- **Tables inside a note:** type `/New data table` in a note and an editable table appears right there, saved with the note itself (Notible Tables 0.7.0, plugin API 1.24). The **+** menu's data table still works as its own item. Sync and Sync Simple merge edits to different cells of such a table from two computers without a conflict copy. (Hive #2)
- **AI cleanup:** an AI assistant connected through MCP can ask to move up to 20 notes to the Trash. Nothing moves until you approve each note in **Settings → AI cleanup** and confirm. A backup is made first, every cleanup is logged, and you can undo it for 24 hours, even after a restart, and also when another computer emptied its trash in the meantime. Cleanup is off until you allow it for the workspace or a project, and notes you mark **Protect from AI cleanup** (or the one that opens on start) are never included. (Hive #13, #22)
- **Sidebar tree setting:** in **Settings → Appearance → Sidebar tree**, keep automatic expansion to the open note, or choose **Manual (only what I expand)** so only the branches you open yourself stay open. (Hive #3)
- **Sync merge notices:** after a sync that kept another device's version over yours, brought back a note you deleted, or saved a conflict copy, a short notice says so in plain words (English or Polish), for example "Sync kept your edit to 'Shopping list': it had been deleted on Laptop." One notice per sync, never one per note: click **Open** to go to the note, or **Details** when several notes were involved. Turn it off with **Show sync merge notices** in the plugin's settings. Plugins can add one button to a notice (plugin API 1.25). (Hive #11)
- **For plugin authors:** plugins get `context.store`, a larger key-value store in its own file. It is never included in backups, is emptied when a backup is restored, and is removed with the plugin (plugin API 1.25). (Hive #5)

### Improved

- **Sync merges edits instead of picking one:** a note edited on two computers between syncs keeps both edits when they touch different lines, and the same goes for titles and properties. A conflict copy is made only when the same line, title or property changed on both, or when the order of the versions can't be worked out. Computers still on an older plugin keep the old behaviour. (Hive #5, #10)
- **Whiteboards, story boards and view tabs merge item by item:** moving a card on one computer and editing another card (or the same card's text) on the other keeps both, with no conflict copy. This covers whiteboards, the Typewriter story board (card positions, frames, timeline) and a folder's or project's view tabs. Both computers dragging the same card, or changing the same view, keeps the newer one without a copy; only different text typed into the same card, frame title or marker keeps the other text in a conflict copy. (Hive #6)
- **Tags and dependencies:** tags and task dependencies added on two computers between syncs are all kept, instead of one list replacing the other. A removal wins unless the other computer changed that entry. (Hive #24)
- **Merge notices are more complete:** the computer whose edit lost is told too, even when it only picks up the other computer's merge. A notice is no longer lost when the upload at the end of a sync fails. Conflict copies are always named and counted, even several copies of one note with the same name, and a long notice continues in the next one instead of being cut off. An archive clash is no longer called a move, and the setting is in Polish too. (Hive #16, #20)
- **For testers (no change for users):** the sync plugins reach Google Drive through one small transport, so two test copies of Notible can sync through a shared local folder in automated tests. That folder works only in debug test builds and refuses links that point outside it; file size, file count and total size are limited, and test scripts clean up only the copies they started. (Hive #9, #17)

### Fixed

- **Sync no longer drops an edit in these cases; both versions are kept, one as a conflict copy:** typing in a note while a sync was applying; the first sync of a note on a computer that had no record of it yet; an edit to a note in the Trash; deleting a table column on one computer while a cell in it was edited on another; a damaged table; and the plugin's own storage being emptied or failing to load. A note moved during a merge, and a conflict copy, now land in the right folder. Long titles with emoji no longer break a conflict copy. (Hive #14)
- **Sync no longer loses an edit when another computer changed the note back to its old text** in the meantime (most likely after a database restore or re-pairing). After a database restore you may see a conflict copy holding the restored, older text of a note that changed since the backup. (Hive #12)
- **A note you move, trash, restore or archive while a sync is running stays where you put it:** the sync picks it up on its next run instead of putting it back, even when the other computer only deleted the note or only changed its folder. A folder change also holds when another computer's clock is ahead. (Hive #18, #19)
- **Workspace view:** conflict copies made by Sync or Teams no longer show in the Workspace lists (projects, due dates); they stay in the sidebar next to the original. **Notible Teams 0.1.2:** a shared project edited on two computers no longer creates a "Notible (conflict copy, …)" project inside itself. (Hive #1)

### Security

- **Plugin trust dialog:** the warning before installing a plugin that contains code is skipped only for a package Notible itself downloaded from an official release and installed. Before, any plugin could claim an official source and get another package trusted without asking. Official market installs still install without the dialog; community plugins always show it. (Hive #8, #21, #23)
- **Notice buttons:** only a real click or key press runs a notice's button, never another plugin's script. (Hive #16)
- **Release safety (no change for users):** the release build stops if the app was accidentally compiled with debug checks on, which would expose test-only features, and automated test copies refuse to start a non-test build, so they can never open your real notes. (Hive #15)

## 0.94.2

- **Boards fill their width again:** columns share the board (at least 260 px each) instead of a fixed narrow width that left half the screen empty; only a board with more columns than fit scrolls sideways.
- **Settings → Appearance:** the Notification sound dropdown lines up with the other settings, with Preview beside it.

## 0.94.1

- **Boards of existing projects show your tasks again.** A project that uses all 11 statuses showed every status as a column, empty ones too, so the columns holding the work (Done, Closed…) sat off screen and the board looked empty. Now it shows only the columns in use, as before 0.93.3; new projects keep their four columns.
- **Whiteboard:** after Esc in a card, the card can be dragged by its body straight away.

## 0.94.0

**Every screen.**

- **Narrow windows:** below 700 px wide the page comes first and the sidebar waits behind a menu button at the top left. It slides over the page, and closes when you open something, tap outside or press Esc.
- **Interface size:** `Ctrl+=` and `Ctrl+-` make everything bigger or smaller, `Ctrl+0` puts it back; also in Settings → Appearance → **Interface size**. Kept per computer.
- **Search:** `Ctrl+K` opens it (`Alt+Space` still works). Every word you type must match, in any order and as part of a word. Your notes and tasks come first, each with the folder or project it is in and the words around the match; "Nothing matches" appears only when nothing in Notes, Settings or Help does. The filters wait behind a **Filters** button.
- **Notes:** the footer with words, characters and backlinks sits right under the text instead of at the bottom of the window, and wraps on a narrow one. Long titles in the sidebar show in full on hover; menus keep their labels on one line.
- **Dark mode:** text and controls were measured against WCAG contrast in Midnight; all pass.
- **Plugins are easier to find:** the + menu ends with **More with plugins…**. A plugin you installed from the market says **Where to find it** (its + menu entries, project tabs, sidebar views), and the Install button only shows a download icon when there is something to download. Before you install one, it lists what it will be allowed to do.
- **Notification sound:** pick None, Soft chime, Bell or Pop in Settings → Appearance (None to start). While Notible is in front, a reminder or a plugin notification shows as a notice inside it with that sound, instead of a Windows notification on top of it.
- **For plugin authors:** plugin API 1.23 — a command can set `whileTyping: true` so its Ctrl/Alt shortcut also works while typing in a note.

## 0.93.3

**Projects that plan.**

- **A simpler board for new projects:** four statuses — To do, In progress, Blocked, Done — shown as columns even while empty, each one width. **⋯ → Show all 11 statuses** brings back the full set for a project; projects made before keep all 11. A task's Properties offer the same statuses.
- **Adding tasks:** a column's **+** adds the task straight into that column. The form puts the cursor in Title, has optional Status and Priority, **Create and add another**, and Esc to close.
- **Cards:** right-click to Open, Rename, change Status, Priority or Due date, or Move to trash. Done cards look done; "None" priority no longer shows.
- **Toolbar and views:** "Showing" names the type picker, **Duplicate view** says what it copies, **+ New view** asks for a name straight away, a view's × shows on hover, and a deleted view comes back with **Undo**.
- **Table:** Due sorts by date and can be changed in the table; the Type column hides when everything is one type; the table fills its width.
- **Calendar:** months follow the app's language; today is marked; double-click a day to add a task there; drag a task to another day. In Planning's calendar, the event form opens next to the day you double-clicked, and events can be dragged to another day.
- **Dates** read the same way you type them, and the date picker jumps to a date as you type it. Assignee says what goes in it. Under **Manual** sort, new tasks go to the bottom.
- **Whiteboard:** a new card is ready to type in and lands where nothing else is; drag a card by its body; **⋯** in the toolbar opens the menu; Report says what it does.
- **Planning and Finance:** a project's **Modules** lists Timeline, Finance and Automations even while their plugins are off, with **Turn on**. Finance is its own plugin now (its tab no longer needs Planning). The timeline has its dates on top, a colour key, and blocked work in its own colour. Each built-in plugin's details say **Where to find it**.
- **One scroll area:** a project's board, calendar and whiteboard scroll with the page instead of inside a short box.

## 0.93.2

- **Help is easier to read** after a full review of every page, in both themes and at three window sizes.
- **Code examples** look like code blocks in a note: one quiet box with **Copy** on the right, and Copy now works in Help. Inline code has a light outline.
- **The current page** in Help's contents is outlined instead of filled with a coloured strip. On a small window the contents drop down over the page, scroll on their own and close with Esc or a click outside.
- **Keyboard shortcuts** in Help show as keys, the same as in Settings → Hotkeys.
- **Pictures and recordings** in Help are up to date, and recordings follow the dark theme too.
- **Help says what the app does:** only plugin shortcuts can be changed; the / menu table lists Table, Link and Image; Import CSV and Export CSV are under **⋯**; Backlinks depend on a setting in Settings → Editor; Planning's Finance tab needs the Finance plugin; JSON export is always available; plainer words for folders, projects and workspaces.
- The / entry for live lists is now **Live list of matching items**.

## 0.93.1

- **Calmer, tidier screens** after a full visual check of every screen at small and full size, in both themes.
- **Plugins:** compact rows; an Update button appears only when there is an update; Reload and Remove are on right-click. On smaller windows you see the list or one plugin's details, with **← All plugins** to go back. Installed market plugins show their real name, description and permissions, every built-in plugin says plainly what it is for and where to find it, instructions start folded, and "Official" no longer flickers to "Community" while the market loads.
- **The + menu** shows one line per item. **Settings** navigation is one line per item, Appearance no longer has a Language row (language lives in Languages), and Recovery, Updates and About lost their repeated labels.
- **Help** on a small window puts the contents behind a **Contents** button so the article gets the room.
- **Notes:** on a small window Properties folds behind a button in the toolbar; on a wide screen the text sits in a comfortable, centred column. Slash-menu commands are one line each.
- **Projects:** the New project dialog fits a small window; tabs no longer show a bare scrollbar and **Modules** is never cut off; Import and Export sit in a **⋯** menu (views and Finance); the table keeps its Title column in place while scrolling sideways; Finance shows a short note instead of seven zeros; Typewriter's empty board and story reference are compact.
- **Right-click on an item:** creating things is folded under **New inside…**, after the item's own actions.
- **Corner helper:** the end of a note scrolls out from under it, so Backlinks are never hidden behind Nib.
- **Plugins in your language:** plugins that ship their own translations (Nib in Polish) now use them.
- **Nib** stands alone in the corner, with no caption. Helpers that are not Notible's own still get one, and plugin ids starting with "notible." are kept for Notible's own plugins. Themes can no longer write text onto the screen.
- Plugin shortcuts in Settings → Hotkeys look like keys (Ctrl + Shift + H).

## 0.93.0

- **New items go where you are.** With a folder, project or note open, **+** creates inside it (the menu says where); one click on "Top level instead" puts it at the top. Tasks made from whiteboard cards go next to the whiteboard.
- **Name first.** Creating a project or workspace asks for its name straight away; what it starts with comes second and can be changed later under **Modules**, which is now a button rather than something that looks like a tab. A new folder needs no dialog at all: just type its name.
- **The header shows where you are**, for example All notes › Home › Garden plan, and each step can be clicked. The open item's folders open in the sidebar so you can always see it.
- **Undo after deleting.** The message after a delete has an **Undo** button that brings everything back and reopens it. The trash in Settings → Recovery has **Restore**, **Delete forever** and **Empty trash** buttons.
- **Right-click a row** for Rename (also **F2** or a double-click), Move to…, Duplicate and New inside; exports and printing sit under one "Export and print" entry.
- **Drag a note onto another row** to put it inside; drop it near the top edge of a row to place it above instead. Move to… also offers notes, never the item itself or anything inside it, and says so when there is nowhere to move to. Open folders stay open after a restart.
- **Messages float** at the top right instead of pushing the page down, including error messages, which now have a close button.
- **Settings and Help keep your notes in the sidebar**, a new screen starts at its top, and **+** or **Notes** closes the search.
- **Version history** says which note it belongs to, opens over that note, and shows the text formatted.
- **Whiteboard:** "Create tasks from cards…" lets you tick which cards become tasks first. An empty workspace overview has **New project** and **New note** buttons.
- For plugin authors (API 1.22): `ui.renderMarkdown` now drops images, and a corner helper that is not built in or signed is captioned "unverified".

## 0.92.2

- **Plainer words everywhere.** Settings no longer talk like a developer: Appearance is "How Notible looks", Recovery explains restoring in one sentence, and About keeps the plugin API and build details under **Technical details**. The sidebar heading is **All notes**, and every item in the **+** menu says in one line what it is for, so Workspace, Folder and Project are easy to tell apart.
- **Restore is a button.** Backups and items in the trash have a visible **Restore** button instead of a right-click menu.
- **Follow system theme.** Theme can now follow Windows' light or dark mode. **Compact** density now really fits more on screen (sidebar, editor and Settings).
- **"Saved".** After you stop typing, the status briefly says Saved, in a calm colour instead of orange.
- **Market:** official plugins have their own section, the community warning only appears over community plugins, each plugin shows a one-line description, Refresh is a small icon, and the install dialog is centred with a clear Cancel.
- **Hotkeys** show plugin names, not internal ids, hide internal commands and show "—" for a free key.
- Settings no longer jump by a few pixels between sections, and short pages have no scrollbar. Help's contents no longer repeat a chapter name as its only page, and the selected page is easier to see. "1 word", "1 item" and "1 backlink" are spelled right. "Set as favourite" is now **Open on start**. The slash menu no longer shows plugin names.
- **Quotes:** Enter in a quote starts a new paragraph below it, Shift+Enter adds a line inside it. `- ` makes a bullet again right after you leave a list.
- **Fixes from testing:** a table's title no longer reverts while Tables saves rows, code typed right after inserting a code block stays in order, picking several `[[` links in a row no longer corrupts the text, and the format bar and code language menu stay on screen near the bottom of the window.
- **Kanban fits the window:** the board takes the height below it, columns scroll inside, and the board's own sideways scrollbar is back. In Settings → Plugins, a plugin's details stay in view on short windows.
- For plugin authors (API 1.22): `context.help` (what this build's Help and plugins cover, and which plugins are on), `ui.openHelp`, `ui.openPluginSettings`, `ui.renderMarkdown` and a `workspace.corner` slot for a helper character. You choose which plugin sits in the corner in **Settings → Plugins → Corner helper**.

## 0.92.1

- **Highlighting can no longer damage your text.** Colouring a word in a list could push the item out of its list, put the colour marks into other lines, or stop one letter short. A selection across several lines is now marked line by line.
- **Links between notes behave.** Picking a note from the `[[` list no longer leaves a stray `]]` that the rest of your sentence ended up inside. A link shows the note's title without brackets as soon as you type it, and **after you rename a note, every link to it shows the new title and keeps working**. Ctrl+click opens a link, a plain click lets you edit it, and **Alt+←** takes you back to the note you came from. The list of notes linking here shows their current names.
- **Tab in a bullet list nests the item**, Shift+Tab takes it back out, and the nesting is kept.
- **Code blocks:** what you type after `/Code block` goes inside the block, indentation is kept, and the language label is a menu, so it can be changed.
- **New in the / menu: Table, Link and Image** (a picture from a file). In a table, Tab in the last cell adds a row.
- **Spell checking follows Notible's language**, not the language of Windows, from the next start after you choose it. Titles, the search box and code are no longer spell-checked.
- **The format toolbar** sits below the selection so it no longer hides the line above, has Heading and Link buttons, and its highlight button no longer looks pressed.
- **Updates are noticed sooner:** Notible checks every hour (was every 6 hours) and when you come back to it after 15 minutes away (was an hour).
- Double-click selects a word in a list item, the word count ignores Markdown marks, headings in a note are smaller than its title, and the text lines up with the title.

## 0.92.0

- **The / menu works on every line.** In a new note it only opened on the first line until you closed and reopened the note.
- **Headings, quotes and checklists appear as you type.** Typing `#`, `##`, `###`, `>` or `- [ ]` at the start of a line, then a space, turns the line into that block at once, instead of only after reopening the note.
- **Enter in the title takes you to the note.** Any text after the cursor moves down with you as the first line.
- **Checklists work properly.** Every new item gets its own box, an unticked box looks empty, and clicking a box ticks it.
- **Ctrl+N works while you're typing in a note.**
- **The / menu is easier to use.** It also searches descriptions (`/check` finds Task list), a space no longer closes it while you type a name like "Heading 1", it opens below the cursor when there is room, and the first item stays selected even if the mouse happens to be over the menu.
- The Copy button on code blocks says "Copy" (it showed a piece of code), the title shows one focus ring instead of two, and the window is called "Notible" instead of "Notible Test Host".

## 0.91.3

- **Kanban scrolls sideways the way you expect.** Columns are back to their full height and the page scrolls down as usual. A scrollbar under the board stays at the bottom of the window, and you can move the board sideways with a mouse's horizontal wheel, Shift+wheel, or by dragging the empty space between columns.
- **The page after signing in with Google is always in English.**
- **Note tags show in Properties.** Tags on notes, including ones added by an AI agent through Notible's MCP server, can now be seen and edited in the Properties panel, like tags on tasks and issues.

## 0.91.2

- **Signing in with Google ends on a proper page.** After you sign in (Sync, calendars), the browser tab shows Notible's mark and "You're signed in" in your browser's language and colour scheme, instead of a line of plain text, and the Notible window comes back to the front.
- **Kanban on small screens.** The board now fits the window and each column scrolls on its own, so the sideways scrollbar is always in view instead of under the longest column. A mouse's horizontal wheel and Shift+wheel scroll the board sideways.
- **Sort by creation date.** Views (except Table, which sorts by its column headers) can sort by Created and Updated as well as Title, Due date and Priority. The control is labelled "Sort" and is saved with each view.
- **Changes made outside the app show up.** When Notible comes back to the front and something else (for example an AI agent through Notible's MCP server) changed notes meanwhile, lists and the sidebar refresh.
- For plugin authors (API 1.21): the `google.identity` sign-in provider returns a Google-signed ID token (e-mail and name) and no refresh token. Notible Teams uses it to know who you are.

## 0.91.1

- For plugin authors: `editor.renderCodeBlockSvg` now returns strict XML. A Mermaid diagram with a line break in a label came back with an unclosed `<br>`, and shown as an image it appeared broken (ReportIt 0.1.15 also works around it on 0.91.0).

## 0.91.0

- **Searching no longer closes the note you are writing.** Typing in the search box closed the open note whenever it did not match the search, and words typed just before could be lost. The note now stays open; the search only filters the list.
- **Search is faster in big workspaces.** Matching now happens in the app's database layer instead of loading every note's full text on each keystroke. It still finds fragments inside words, such as part of a long ID.
- **Properties are saved to the right note.** Changing a property and opening another note within half a second could write that change onto the other note. It now always goes to the note you edited, and closing the panel saves it instead of dropping it.
- **A whiteboard keeps its last change** when you switch to another board or close it right after editing.
- **Text is kept when a save fails as you leave a note.** It comes back the next time you open that note and is saved again.
- **Quit from the tray and installing an update save your note first.**
- **"Saving…" means saving.** Loading the note list no longer shows it, and no longer greys out unrelated buttons for a moment.
- **More of the app speaks Polish:** the Typewriter Board and Codex, the whiteboard, planning, views, table and code menus in the editor, document stats and several Settings panels were still in English.
- A plugin that never finishes starting no longer holds back the plugins after it; after 30 seconds it is reported as failed.
- For plugin authors (API 1.20): `context.editor.renderCodeBlockSvg` returns a code block's drawing as SVG, so a plugin can print Mermaid diagrams. ReportIt 0.1.14 uses it.

## 0.90.6

- **Typewriter Board: renaming a node saves when you click on the board.** Typing a new node's name and then clicking another card or the empty board used to keep showing "New node" (only a click outside the Board refreshed it).
- **Typewriter Board: drop a card onto a frame to add it.** A card dropped inside a frame it doesn't belong to joins that frame, and the frame grows with it. Or right-click a card → **Add to frame** and pick one of the existing frames (the selected cards move with it). Right-click → Remove from frame takes it out again.
- **Project views: "All types" is back in the Type menu.** A view filtered to Tasks can show everything in the project again, including tables and other plugin objects.

## 0.90.5

- **No more lost words when switching notes.** Text typed less than a second before opening another note was never saved. It is now written the moment you leave the note.
- **Pictures behave like in Word.** A picture on its own line now has a place for the cursor right after it: click beside it and press Enter for a new line. Before, a click next to or on a picture put the cursor into the diagram's code below it, or at the very top of the note.
- There is room under the last block of a note to click into, and the label bar of a code block no longer catches the cursor.
- **Columns blocks keep their content.** Editing anything in a note that had a Columns (or Calendar) block wrote that block back empty.
- **Select all, then paste or type, replaces the whole note.** When a note started with a code block or a quote, or ended with a diagram, the new text used to land inside that block and parts of the old note stayed.
- **Pasting a screenshot in a code block, a table or a Columns block** puts it on the line right under the block instead of inside it (it broke the code, or cut the table in two). Pasting a web address, a link or several lines into a table cell or a Columns line keeps the table in one piece.
- Clicking under a note that ends with a table, a divider, a Columns block or a picture starts a new line there (a table or divider sent the cursor to the top of the note); under a heading or list it goes to the end of it.

## 0.90.4

- **Writing below a diagram at the end of a note.** When a diagram (or any code block) was the last thing in a note, clicking under it or pressing Ctrl+End put the cursor into its hidden code, so typing quietly broke the diagram. Now the cursor goes to a new line under it; the Down arrow on the block's last line leaves it too.
- Pasting a picture into a list item replaces selected text, like every other paste.
- **Web links.** Select text and paste an address to turn it into a link; pasting a bare address or text from a web page keeps links too, and `[text](https://address)` can be typed by hand. A link shows as its text with a small arrow; put the cursor in it to change the address, Ctrl+click to open it. Only web and e-mail addresses become links.
- **Tab works like in a text editor.** In a note, Tab no longer jumps to the next button or field: it adds a tab gap in text, indents in a code block (Shift+Tab outdents; with several lines selected, all of them), moves to the next cell in a table (Shift+Tab goes back), and picks the item in the / and [[ menus. To leave the note with the keyboard, press Esc and then Tab. Everywhere else in the app Tab moves between fields as before.
- Pasting part of a sentence from a web page now lands where the cursor is, instead of on new lines of its own, and a space typed right before a paste is kept.

## 0.90.3

- **Paste replaces the selection.** Selecting text and pasting now replaces it, like in any other editor — before, multi-line text, tables, code and web content were inserted in front of the selection.
- **Mermaid diagrams follow the dark theme** instead of always drawing on a white background.
- **No more blinking diagrams.** An open note with a diagram no longer flashes every time something is saved in the background (sync, automations, reminders).
- A diagram's code now folds away when you click outside the editor, not only when you move the cursor elsewhere in the note.
- **Diagram buttons.** Hover a diagram: **Expand** opens it full screen (scroll to zoom, drag to move, Esc to close), **Copy image** copies it as a picture for mail or documents, **SVG** / **PNG** save it to a file.
- **Diagram settings.** A diagram can carry its own look — theme, hand-drawn style, spacing — in a short `config:` header at the top of its code; it syncs with the note. `layout: elk` switches to a second layout engine that arranges bigger diagrams more neatly. See Help → Editor extensions.

## 0.90.2

- Scheduled date automations no longer rewrite projects when a rule has already run, preventing repeated sync conflicts caused by automation logs.
- Companion plugin updates: Sync 0.4.5 and Sync Simple 0.5.5 prevent trash-only changes from creating duplicates and keep genuine losing edits in trash. Update your sync plugin on every device separately.

## 0.90.1

- **Version history.** Every note keeps its earlier versions, one per
  editing session. Click "Edited …" at the bottom of a note, or right-click
  anything in the sidebar and choose "Version history". Pick a version to
  read it, restore it (a restore can be undone the same way), delete it, or
  clear the whole history.
- A note open on this device now picks up a change synced from another
  device right away instead of within half a minute — and never while you
  are typing in it.
- If a note changes on another device while you are typing, your typing
  wins; the other version is kept in Version history and a message says so.
- Versions that arrive by sync are kept apart from your own, so they can
  never push your own versions out of the history.
- A right-click menu opened near the bottom of a long sidebar is moved up
  to fit the window. The longer menu of a project or folder used to run off
  the bottom, and its last items (Version history, Delete) could not be
  reached.
- Automations with a "date reached" rule no longer rewrite their project
  every 15 minutes just to note that a task was already handled. With sync
  on, that endless rewriting left a new "(conflict copy)" of the project
  on every sync.

## 0.90.0

- **Help** — a guide to Notible inside the app, from getting started to
  every built-in plugin. Open it from the sidebar (above Settings) or press
  F1 anywhere. It explains the + and / menus, writing, folders vs projects vs
  workspaces, the kinds of items, shortcuts, search, views, moving,
  exporting and restoring, and settings, with screenshots and short clips.
- Search now finds Help pages too, in their own group; a result opens the
  page at the matching heading.
- Deleting from a row's right-click menu now says what really happens: the
  item goes to the trash and can be restored from Settings → Recovery. It
  used to say "This cannot be undone."
- Includes everything from 0.89.4 below (it was not released on its own).

## 0.89.4

First part of the 1.0 polish, from a fresh-install walkthrough.

- The / menu no longer offers blocks that nothing would draw: "Live list of
  matching objects" appears only with Embedded queries on, "Mermaid
  diagram" only with Editor extensions on. The "Calendar" block, which was
  only ever an empty frame, is gone from the menu (old notes still open).
- Settings, Plugins: in the default window size a plugin's details now sit
  beside the list instead of below it, off screen. In a narrower window,
  clicking a plugin scrolls to its details.
- Search with no results says so, instead of "No notes yet.".
- Back in Settings now leaves Settings in one click.
- Plainer wording everywhere a new user looks: the start screen explains
  + and /, messages and the / menu no longer show internal plugin IDs or
  "Core", built-in plugins read "Built in" instead of "Core · v0.1.0", empty
  views say "Nothing here yet." instead of "No records match this view.",
  and the "Plugin boundary" note is gone from Appearance.
- Polish: the sidebar's Notes and Settings, Back and the new texts are
  translated.

## 0.89.3

- Editor extensions: a Mermaid diagram with a syntax error no longer leaves
  red "Syntax error in text" pictures piling up below the app. The error is
  shown only inside the block, as intended.
- Editor: Backspace at the start of the line below a code block or diagram
  moves into the block (and removes the line if it was empty) instead of
  merging it into the code and leaving an empty block frame behind.
- Editor: Backspace in an empty code block removes the whole block.
- Editor: two Enters at the end of a code block leave it again (broken in
  0.89.2).

## 0.89.2

- Editor: clicking the "mermaid · edit" bar above a drawn diagram now
  really opens its code (in 0.89.1 it did nothing). Right-clicking a drawn
  diagram also offers "Edit code" and "Copy code".
- Editor: pressing Enter at the end of the last line in a code block now
  starts a new line instead of leaving the caret where it was.
- Editor: typing a closing bracket right before the one that was inserted
  automatically now steps over it, instead of producing `]]` / `))` / `}}`.

## 0.89.1

- Editor: a new "Mermaid diagram" entry in the / menu inserts a working
  flowchart that draws immediately.
- Editor extensions: a drawn Mermaid diagram now hides its code. Click the
  "mermaid · edit" bar above it to edit the code; click outside the block to
  see the diagram again. A diagram with an error keeps its code visible.
- Plugin Details: links in a plugin's instructions (such as the Mermaid
  documentation) are now clickable and open in your browser.
- Editor extensions: the instructions now explain step by step how to add
  a diagram, including the exact opening and closing lines it needs.

## 0.89.0

- Typewriter: fixed the writing streak never starting on a manuscript's
  first tracked day — writing 17 words today showed "No streak yet" because
  there was no prior day to compare against yet. First-day writing now
  correctly starts a 1-day streak (and repairs a manuscript already stuck
  in this state from before the fix).
- Editor extensions: ```mermaid code blocks now render as real diagrams
  (flowcharts, sequence diagrams, class diagrams, Gantt charts, and more),
  using the actual open-source Mermaid project — not an approximation.
  Details in Settings → Plugins → Editor extensions explain what it is,
  with examples and a link to Mermaid's own documentation.
- Typewriter: the streak indicator is now a themed icon instead of an emoji.
- Fixed the app window not remembering its size, position or maximized/
  fullscreen state after installing an update — only after an ordinary
  close. The updater exits the process directly instead of closing the
  window normally, so that state was never being saved before this fix.

## 0.88.2

- Typewriter: a new "Export as PDF (print)" button next to "Export as Word"
  — opens the system print dialog; choose "Save as PDF" as the printer.
  Same content as the Word export, browser-paginated.
- Typewriter: Progress now shows a 10-week activity heatmap under the
  streak, and a native notification in the evening if a streak is about to
  break because nothing has been written yet that day.

## 0.88.1

- Typewriter: fixed a bug where a blank line between paragraphs became an
  extra empty paragraph in the compiled note and the DOCX export, showing up
  as unwanted gaps in the exported text.
- Typewriter: "Export as Word (.docx)" now opens a native "Save As" dialog
  — pick any folder, not a fixed one — and confirms where the file landed.
- Plugin API 1.19: `context.ui.exportBinaryAs`, a binary export through a
  native "Save As" dialog instead of the fixed exports folder. No built-in
  plugin but Typewriter uses it yet.

## 0.88.0

- Typewriter: text written directly in a chapter (without adding scenes) is
  no longer dropped by "Compile to a note" — it used to compile to nothing
  but the chapter's heading. Chapter/part rows in the outline also now
  report their own word count instead of always showing 0 words when they
  hold text but no child scenes.
- Typewriter: the empty-manuscript hint now points at writing straight into
  a chapter first, with scenes described as optional (for per-scene
  POV/status tracking) rather than a required next step.
- Typewriter: a new "Export as Word (.docx)" button next to "Compile to a
  note" — standard manuscript format (Times New Roman, double-spaced,
  indented paragraphs), for sending a draft to a beta reader, agent or
  editor outside Notible. "Compile to a note" stays as the in-app,
  editable step; the new button is for sharing outside the app.
- Typewriter: Progress now shows a daily writing streak — any day with
  progress on the manuscript keeps it going, a day with none breaks it.
- Typewriter: a part, chapter or scene's right-click menu can now save a
  text snapshot before a big rewrite, and reopen any earlier one as a
  separate note to compare or copy back from.
- Typewriter: an empty manuscript can now start from a story-structure
  template — Three-Act Structure or Save the Cat! (15 beats) — instead of
  adding every part and chapter by hand. Each beat's purpose is pre-filled
  as its synopsis. Optional; a blank manuscript works exactly as before.

## 0.87.6

- Settings, Plugins: installing or updating an official plugin (published by
  the Notible developer) no longer shows a second native "this package
  contains code" warning — the in-app confirmation already covers it. A
  community plugin still shows both, unchanged.
- Settings, Plugins: a new "Update all" button appears when two or more
  official plugins have a pending update, installing them all in one click.
  A community plugin's update still needs its own individual click.

## 0.87.5

- The window now remembers its size, position and maximized state across
  restarts, including the one after an auto-update. It used to reset to the
  default size every time.
- Windows auto-update no longer shows an installer progress window. There was
  nothing to click either way, so it now installs silently in the background.
- The Windows installer has its own header and sidebar artwork instead of the
  generic NSIS look.
- Settings, Plugins: the "Import Markdown" button in the sidebar no longer
  flickers while a note is autosaving.
- Settings, Plugins, Other: a plugin's update badge no longer snaps in
  abruptly once the market check finishes — it now fades in.
- Plugin API 1.18: three new capabilities for plugin authors —
  `context.ui.confirm` (a themed confirmation dialog), `context.data.objects.onChange`
  (react to a single object changing), and `context.data.objects.findByTitle`
  (look up an object by title without pulling thousands of objects client-side).
  No built-in plugin uses these yet.

## 0.87.3

- Settings, Plugins: the Details panel now fades in when you click another
  plugin, instead of just appearing.
- The Reload arrow (in the list and in Details) turns a full circle when you
  point at it.
- Deleting a note you opened from another place (for example a thought captured
  on the Workspace screen) now takes you back to where you came from, or to its
  parent. It no longer jumps to the first note in the list.
- Plugins: the "Verified / Unverified" label is replaced by "Official" (published
  by the Notible developer, judged by where the package was downloaded from) and
  "Community". Plugins carry no cryptographic signature, and the text now says so.
- Graph 0.11.5: while the graph settles the view follows it smoothly, instead of
  the picture stopping and zooming out in one cut.

## 0.87.2

- Themes: a theme's colours now also take effect on the dark base. Before, a
  dark theme's colour tokens lost to the built-in Midnight rules and did not
  apply. Theme images may be up to 1.4 MB each (larger ones were silently not
  displayed by the browser engine).

## 0.87.1

- Themes: theme authors get stable hooks. New tokens paint the whole app
  background, the sidebar (including a glass blur), the main area and the note
  text size and line height, and stable attributes let a theme target light or
  dark mode, its own activation, the density and the sidebar, main area and
  editor. Nothing changes for the built-in themes.
- Developer pack (Settings, Plugins, Market): now also contains the guides for
  building and publishing a theme or a language (THEME_PACKS.md,
  LANGUAGE_PACKS.md), the example glass theme and the current list of all
  translatable strings.

## 0.87.0

This release also includes the 0.86.0 changes below.

- Languages: Settings has a new Languages screen. Anyone can publish a language
  as a single file on GitHub; you install it with one click (or paste a
  repository) and choose it in Notible. Installed languages can be removed.
  English and Polish stay built in.
- Themes: the Themes plugin now holds community themes. A theme is a styles-only
  package from GitHub that can change colours, backgrounds, glass effects and
  animations, and it cannot run code. Install one from the list or straight from
  a repository, switch between them, update or remove them. Daylight and
  Midnight stay in Settings, Appearance and are not affected. The old built-in
  Paper and Midnight extras and the colour editor in Themes are gone.
- Safety: if a theme makes Notible hard to use, press Ctrl+Alt+Shift+T to turn
  it off. A theme is also turned off automatically if Notible did not start
  cleanly with it. Delete and restore confirmations cannot be hidden by a theme.

## 0.86.0

This release also includes the 0.85.1 changes below.

- Language: every Settings screen is now translated. With Polish selected,
  Settings, its section list, the Plugins screen (groups, details, market),
  Recovery, Updates and About all appear in Polish, and Settings search results
  are translated too. The rest of the interface follows in small steps.
- Footnotes: when you delete a footnote marker in the text, its note at the
  bottom is deleted with it in the same step, so Ctrl+Z brings both back. If
  you cut a marker and paste it elsewhere, its note comes back with it.
  Editing a marker (for example deleting one of its brackets to retype it)
  never removes the note.

## 0.85.1

- Whiteboard: removing a connection now works like on the Typewriter board.
  Hover a line and click the round "×" that appears on it; the button is
  placed on a stretch of the line that no other line touches.
- Settings, Plugins: on a wide window the selected plugin's details now sit
  beside the list (and stay in view while you scroll it). On a narrower window
  they still appear below the list.
- Themes: the Themes screen now shows the theme that is really in use. It
  follows the Theme setting in Appearance, and the theme you pick there is
  remembered when you restart Notible (before, it fell back to the base theme).

## 0.85.0

The Whiteboard gets the same right-click menus and colour language as the
Typewriter board, and several things that did not work now do.

- Whiteboard: right-click a card, shape, table, image or note for its options:
  Colour, Link to note, Connect to, Duplicate, Bring to front, Send to back and
  Delete. Right-click the empty board to add a card, shape, section, table,
  image or linked note exactly where you clicked, or to open the Report,
  create tasks from cards, Export and Reset view. The top bar now only holds
  Card, Shape, Section, Table, Image and zoom.
- Whiteboard: colour is a ribbon down a card's edge instead of a full colour
  fill. Boards that used the old pastel cards keep a matching ribbon.
- Whiteboard: a Shape is now a real diagram form with a centred label and a
  choice of Rectangle, Rounded, Ellipse or Diamond (right-click, Form). Its
  colour outlines and tints it. A Card stays a text card with a ribbon.
- Whiteboard: images can be moved anywhere (they could only be moved inside a
  Section).
- Whiteboard: a Table no longer shows extra scroll bars or gets cut off. It
  grows with its rows, and right-click, Table adds or removes rows and columns.
- Whiteboard: a Section's resize corner is always on top, so you can drag it
  even when a card overlaps the corner.
- Editor (manuscripts): the A4 page line is now placed by counting characters
  (about one page of 12 pt text) and drawn as a clearer dashed line under the
  text line where the page ends. Paragraph spacing no longer throws it off.

## 0.84.1

- Board: when two connections overlap or cross, the round "×" is now placed
  on a stretch of the line that no other line touches, and it is drawn above
  every line, so pointing at it always removes the line you are hovering.
- Footnotes: Ctrl+click works both ways. Ctrl+click a marker in the text to
  jump to its note, and Ctrl+click the number in front of a note to jump back
  to that spot in the text. The place you land on is briefly highlighted.
- Footnotes: web addresses in a note become links. Ctrl+click one to open it
  in your browser. (A link appears once the note has been saved and reopened.)
- Compiling a manuscript now renumbers footnotes across all scenes, so
  numbers no longer clash between scenes, and gathers them in a "Notes"
  section at the end of the compiled note. Printing or saving a note as PDF
  now formats footnotes too.
- Page line (A4): the line is an estimate based on the width of your text.
  A note made of many short paragraphs, each with extra space around it, runs
  past the line sooner than the line suggests.

## 0.84.0

Typewriter gets a much more capable Board, and long-form writing gets footnotes
and a page guide.

- Board: connections can now start from any side of a card (top, bottom, left
  or right) and route vertically as well as sideways, with an arrowhead on
  every line. To remove a connection, hover it and click the round "×" that
  appears in its middle; the line is thicker on hover and easy to hit.
- Board: node colours are a wider, clearer ribbon, readable in the dark theme.
- Board: the right-click menu is now Rename, Colour, Link to Codex and Delete.
  Colour opens a list of capitalised colour names beside the menu.
- Board: select several cards with Shift-click or by dragging a box on the
  background, then move them together (connections follow). "Group into
  frame" draws a titled frame around them; frames can be nested (scenes in a
  chapter, chapters in a part), dragged as one, renamed, and ungrouped.
- Board: a loose timeline ruler along the top. Add markers such as "Day 1" or
  "12 years later", drag them sideways, and flag a marker as a time jump.
  Markers carry no scale, so a leap of years fits beside consecutive days.
- Board: link any card to Codex entries (characters, locations, plotlines and
  memos). Linked entries show as small tags on the card.
- Codex: a new Memos category for loose thoughts, research and "extras".
- Editor: footnotes. Press Ctrl+Alt+F (or use the ¹ button when text is
  selected) to add a numbered marker at the cursor and open its note at the
  end of the text, where you can write a source or an explanation. Ctrl-click
  a marker to jump to its note.
- Editor (manuscripts): a faint, unnumbered line shows where a printed A4 page
  would end, so you can see roughly how long the text is on paper.

## 0.83.13

- Pasting from a web page now keeps its structure: headings, bulleted and
  numbered lists, tables and bold/italic come through instead of arriving as
  flat lines, and text that a page wraps across several source lines stays
  one paragraph. (Hyperlinks are not supported by the editor yet, so links
  paste as plain text.)
- Workspace "Capture a thought": the line under each item now sits level
  with the Type and Project pickers.
- Table views: removed the small "Type" label above the type picker, so the
  toolbar controls line up.

## 0.83.12

- New notes, tasks, issues and other items created from the "+" menu open
  with the cursor in the title (the default name is selected), so you can
  just start typing. New parts, chapters and scenes in Typewriter can be
  named in place the same way.
- Workspace "Capture a thought": the Type and Project pickers now use the
  same themed dropdowns as the rest of the app, with capitalised types.
- Typewriter: the word count no longer touches the edge of the highlighted
  row, and switching between Manuscript, Codex, Progress and Board no longer
  makes the whole page blink.
- Properties: removed the doubled line above "Add property".
- Whiteboard: a Section now always sits behind your cards, so cards inside
  it can be grabbed, and dragging a Section moves the cards inside it.

## 0.83.11

- Fixed dragging cards on the Kanban board: the card you were holding
  appeared far away from the cursor. It now follows the cursor again.

## 0.83.10

- Automations now read like a sentence: "When …, only if …, then …",
  with a plain-language summary of each rule right under its name.
- Every rule shows how many items it would change right now, and a new
  "Run now" button applies it to all of them at once, after you confirm.
  It also works for rules that normally run by themselves, so you can catch
  up on items that were already overdue when you created the rule.
- Conditions now offer choices that fit the field: dates get "is before",
  "is after" and "is overdue", tags get "has tag". Comparing dates with the
  old "less than" / "greater than" used to silently match nothing.
- Each rule shows when it last ran and how many items it changed.
- A warning appears when a rule sets a status or value that no item in the
  project uses yet.
- Scheduled rules can now run for each matching item in the project, not
  only on the project itself.
- The date and time a note was created now shows at the right end of the
  line under the editor that counts words and characters.
- The Automations screen is tidier: a narrower layout, controls that line up,
  a smooth open/close for each rule, buttons that react to clicks, and a
  spinner while a rule is running.
- The Execution log shows much more: where a run came from, how long it took,
  what each step changed and, when something fails, the full error. You can
  filter it, copy an entry's details for debugging, and clear it. Runs on many
  items are grouped into one line.
- Automations that fail in the background are now recorded in the log instead
  of silently doing nothing.

## 0.83.9

- Fixed the Release notes page itself showing a stray block of raw text
  above the actual notes.
- A few small wording fixes for clarity, found by testing the last release
  end to end.

## 0.83.8

- Calendar event reminders now actually fire — the reminder option on an
  event (5 minutes before, 30 minutes before, etc.) previously did nothing.
- Automations: a rule with "Stop on first error" turned off now keeps going
  past a failing action instead of the setting being ignored; changes an
  earlier action already made are no longer silently lost when a later one
  fails.
- Automations: a rule that gets caught in a trigger loop now leaves a clear
  note in the execution log instead of just going quiet.

## 0.83.7

- Fixed: the global Back button, when leaving a plugin's generated-document
  preview (e.g. ReportIt), no longer skips past the plugin back to whichever
  screen you'd visited before it.
- ReportIt: real page-accurate PDF pagination, cover logos, footer alignment
  and page numbers, and a smoother drag-to-reorder for report sections.
- Settings → About: "Release notes" now opens this page in the app instead of
  a broken link.

## 0.83.6

- Search filters (Kind/Where/Tag/dates) redesigned as a row of pill-shaped
  chips using the same dropdown and date-picker controls as Properties and
  Planning.
- Fixed plugin type names showing lowercase in the "Any kind" filter.

## 0.83.3

- Fixed right-click menu text overflowing its border, and a flicker on the
  "Back to parent" button in a subfolder.

## 0.83.2

- Fixed context-menu text overflowing its border, and a brief flash of the
  sidebar's "+" button during fast operations.

## 0.83.1

- Fixed the right-click menu rendering underneath the main panel, and Delete
  from that menu not responding.

## 0.83.0

- Smooth transitions between Gallery/List/Table/Kanban/Calendar views in a
  Project.
- Undo/redo in the editor.
