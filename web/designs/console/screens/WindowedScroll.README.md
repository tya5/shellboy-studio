# Windowed conversation scroll

Earlier-history variant: when the first rendered ordinal is greater than zero and the immediately older item is not loaded, show Load earlier at the top edge. It calls the existing `requestOlder` path, which uses the window reader and anchor preservation. Do not show it if older history is already loaded or the first ordinal is zero.
