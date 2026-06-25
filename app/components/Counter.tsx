import { useState } from "react";

// Example interactive component — demonstrates local state and a click handler.
// Its test (Counter.test.tsx) is the canonical `@testing-library/user-event`
// example: simulate a real click and assert the result.
export function Counter() {
  const [count, setCount] = useState(0);
  return (
    <button type="button" onClick={() => setCount((c) => c + 1)}>
      Count: {count}
    </button>
  );
}
