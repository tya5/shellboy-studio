# useRowMenu

The row owns menu open state, the actual vertical-dots button, and its opener
reference. It returns row handlers, an in-flow trigger, `menu`, and `open` so the
row keeps the trigger visible while Escape returns focus. It dispatches no custom
DOM events and performs no trigger lookup.
