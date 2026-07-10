import { useState } from "react";
import { Switch } from "./Switch";

interface FormSwitchProps {
  name: string;
  defaultChecked?: boolean;
  disabled?: boolean;
  className?: string;
}

export function FormSwitch({ name, defaultChecked = false, disabled, className }: FormSwitchProps) {
  const [checked, setChecked] = useState(defaultChecked);
  return (
    <>
      <input type="hidden" name={name} value={checked ? "on" : ""} />
      <Switch checked={checked} onChange={setChecked} disabled={disabled} className={className} />
    </>
  );
}
