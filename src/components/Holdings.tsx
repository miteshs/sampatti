// The merged "Holdings" tab: manage what you own AND add more, in one place (Add data + Manage
// used to be two tabs). First run (no data) shows just the AddData welcome — load the demo or
// import statements, with the "How it works" guide. Once there's data, the Manage list sits on
// top and AddData becomes the "Add more" section beneath it.
import { useStore } from "../storage/store";
import { Manage } from "./Manage";
import { AddData } from "./AddData";

export function Holdings({ onConfigure }: { onConfigure?: () => void }) {
  const hasData = useStore((s) => s.portfolio.holdings.length > 0 || s.portfolio.accounts.length > 0);
  return (
    <div className="grid" style={{ gap: "1.25rem" }}>
      {hasData && <Manage />}
      <AddData onConfigure={onConfigure} />
    </div>
  );
}
