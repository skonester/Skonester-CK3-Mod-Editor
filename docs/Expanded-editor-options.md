# Expanded editor options

## Religion settings

Open a mod religion and use **Religion settings** to change its theocracy
government, tenet background icon, pagan roots, reserved names, and custom
faith icons. For 1.20 religions, this also exposes the main holy site and
minimum/maximum counts for eminent and total holy sites. Total counts include
eminent sites. Empty fields retain the game's default or inherited value.

**Virtues and sins** edits the contents of the religion's `traits` block.
All game-supported trait forms are available, including spiritual fulfillment
weights introduced in 1.20:

```text
virtues = {
    brave
    generous = 0.5
}
sins = {
    stubborn = { scale = 2 weight = 3 }
}
```

The editor preserves unchanged script and validates balanced braces and quotes
before writing changed trait settings. This is structural validation; CK3
still needs to validate the trait keys and gameplay behavior.

## Faith and rite settings

Standalone 1.20 faiths expose their rite-head title, origin faith, graphical
faith, theocracy government, historical status, associated cultures, and
reserved male/female names under **Faith settings**. Culture and government
pickers load the current mod and game references; custom ids can also be entered.

Rites expose associated cultures and static name/description localization
keys. Changing these keys selects existing localization; the editor does not
write localization files. Dynamic name or description blocks stay protected
and can be opened in the external definition editor.

Existing unsaved faith, rite, and religion drafts are upgraded with these
settings from their current files. Explicit edited values, including cleared
fields, remain in the draft.

## Faith history

1. Open a 1.20 faith and click **Faith history** beneath its main-rite picker.
2. Select an entry to inspect it, or choose **Add entry**. **Use as new entry**
   starts a copy in the mod, including entries originally defined in the game.
3. Enter a date and, for a new entry, a mod file name. Relative subfolders such
   as `custom/faith_history.txt` are supported.
4. Use **Fields** for creation, main rite, religious head, and known/permitted/
   prohibited tenets. Use **Complete script** for nested rite changes and all
   other settings. These views edit the same script.
5. Save the entry. Existing mod-entry drafts survive closing the dialog,
   changing editors, and restarting the app; **Revert** restores the file.

Complete script contains the statements inside the dated block, without its
date wrapper. For example:

```text
created = yes
main_rite = my_rite
permitted = { tenet_communion }
rites = {
    my_rite = {
        enabled = yes
        tenet_setup = {
            dlc_feature = { by_god_alone }
            tenets = { tenet_apostolic_succession tenet_communion tenet_peace_of_god }
        }
        tenet_setup = {
            tenets = { tenet_communion tenet_asceticism tenet_adaptive }
        }
        doctrines = { doctrine_monogamy }
    }
}
popularity = { tenet_communion = 10 }
```

The reader understands both `rites = { id = { … } }` and repeated
`rite = { rite = id … }` blocks. The complete-script view preserves the
definition's syntax until edited.

History accumulates over time. Clearing a field removes its statement at this
date; it does not undo an earlier history change. A faith cannot be un-created.
New entries append separate faith blocks, preserving existing file bytes.
Duplicate dates remain separate because CK3 executes every entry at that date.

Game entries are viewable; saves always target the selected mod. Before saving
or deleting an existing entry, the app compares its date and body with what
was loaded. If an external edit changed it, reload and review the current
script. Structural validation does not evaluate triggers, DLC conditions, or
bookmark-specific results; test those in CK3.
