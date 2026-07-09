import { settingsSectionGroups, type SettingsSectionId } from "@/lib/settingsNavigation";
import { cn } from "@/lib/utils";

export function SettingsNavigation({
  activeSection,
  onSelect,
}: {
  activeSection: SettingsSectionId;
  onSelect: (section: SettingsSectionId) => void;
}) {
  return (
    <nav
      aria-label="Settings sections"
      className="rounded-xl border border-white/10 bg-white/[0.03] p-2 lg:sticky lg:top-4"
    >
      <div className="grid gap-1.5 sm:grid-cols-2 lg:grid-cols-1">
        {settingsSectionGroups.map((group) => (
          <div key={group.label} className="space-y-1">
            <p className="px-2 pt-1 text-[10px] font-semibold uppercase tracking-wide text-gray-500">
              {group.label}
            </p>
            {group.sections.map((section) => {
              const active = activeSection === section.id;
              return (
                <button
                  key={section.id}
                  type="button"
                  onClick={() => onSelect(section.id)}
                  className={cn(
                    "w-full rounded-lg px-3 py-2 text-left transition-colors",
                    active
                      ? "bg-amber-500/12 text-white ring-1 ring-amber-400/35"
                      : "text-gray-400 hover:bg-white/5 hover:text-gray-200"
                  )}
                  aria-current={active ? "page" : undefined}
                >
                  <span className="block text-sm font-medium leading-5">{section.label}</span>
                </button>
              );
            })}
          </div>
        ))}
      </div>
    </nav>
  );
}
