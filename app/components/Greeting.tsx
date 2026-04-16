import { formatGreeting } from "~/utils/format";

interface GreetingProps {
  name?: string;
}

export function Greeting({ name }: GreetingProps) {
  return <p>{formatGreeting(name)}</p>;
}
