import React from "react";
import { useApp } from "ink";

const TUIBackContext = React.createContext<(() => void) | null>(null);

export function TUIBackProvider({
  children,
  onBack,
}: {
  children: React.ReactNode;
  onBack: () => void;
}): React.ReactElement {
  return (
    <TUIBackContext.Provider value={onBack}>
      {children}
    </TUIBackContext.Provider>
  );
}

export function useTUIBack(): () => void {
  const inherited = React.useContext(TUIBackContext);
  const { exit } = useApp();
  return inherited || exit;
}
