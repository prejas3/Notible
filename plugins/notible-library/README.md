# Notible Library

An official, offline-first collection for books, films, series and games. Version 0.3.0 adds an explicit **Find online** action for books through Open Library. Items remain ordinary synced Notible objects, but are children of a library and hidden from the workspace tree; search, links and backlinks still find them.

## Use

Open **Libraries** in the sidebar to list or create libraries. A library can live at the top level or inside any normal container and can be moved with **Move to**. Open it for its shelf and full new-item form. The library's kind presets the form; ratings use hoverable stars and can be cleared. Opening an item shows a **Back to library** action and the same star control.

The **+** menu offers **New library** and **New library item**. Creating an item inside a library uses it immediately; elsewhere, Notible's picker asks which library to use and opens that library's full form.

For a book, enter a title or ISBN and choose **Find online**. Search runs only on that click. Picking a result fills title, author, year, ISBN, description, link and cover only where the form is still empty, so typed values are never overwritten. The selected cover is downloaded into managed Notible media for offline use and sync. The same form is available on an existing item's **Library details** tab.

When 0.2.0 first sees 0.1.0 items without a library, it creates **My library** (**Moja biblioteka** in Polish) and moves them there. Re-running the migration is safe and does not create duplicates.

## Permissions

- `data.read` / `data.write`: list and create library items.
- `media.read`: render covers pasted elsewhere. Covers picked by Library remain readable through the plugin's own media ownership even when the pasted image setting is off.
- `media.write`: open Notible's image picker and store the chosen cover.
- `network`: search Open Library only when **Find online** is clicked.
- `workspace.ui`: render the Library view and quick-add dialog.

Declared hosts are `openlibrary.org`, `covers.openlibrary.org`, `archive.org` and `*.archive.org` (cover redirects). Core enforces that list for cover import. Cover files are limited to supported image formats and 20 MB by Core.
