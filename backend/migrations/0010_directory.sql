-- The directory of people (decision 0036): every signed-in account, found by
-- name in the new-conversation picker. `name_key` is the name as a search
-- compares it: lower case, with the Icelandic letters folded to the plain
-- ones a keyboard without them types (ð d, þ th, æ ae, ö o, accents dropped),
-- so "gudrodur" finds "Guðröður". `nameKey` in src/profiles.ts folds a search
-- the same way, and test/directory.test.ts holds the two together.

ALTER TABLE accounts ADD COLUMN name_key TEXT GENERATED ALWAYS AS (
  lower(
    replace(replace(replace(replace(replace(replace(replace(replace(replace(replace(
    replace(replace(replace(replace(replace(replace(replace(replace(replace(replace(
      display_name,
      'Á', 'a'), 'á', 'a'), 'Ð', 'd'), 'ð', 'd'), 'É', 'e'), 'é', 'e'), 'Í', 'i'), 'í', 'i'),
      'Ó', 'o'), 'ó', 'o'), 'Ú', 'u'), 'ú', 'u'), 'Ý', 'y'), 'ý', 'y'), 'Þ', 'th'), 'þ', 'th'),
      'Æ', 'ae'), 'æ', 'ae'), 'Ö', 'o'), 'ö', 'o')
  )
) VIRTUAL;

-- The picker reads verified accounts first, then by name, a page at a time.
CREATE INDEX accounts_directory ON accounts (verified DESC, name_key, account_id)
  WHERE display_name IS NOT NULL;
