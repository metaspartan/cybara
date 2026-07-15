import { settingsSectionGroups, type SettingsSectionId } from "@/lib/settingsNavigation";
import { useI18n } from "@/lib/i18n";
import { cn } from "@/lib/utils";

export function SettingsNavigation({
  activeSection,
  onSelect,
}: {
  activeSection: SettingsSectionId;
  onSelect: (section: SettingsSectionId) => void;
}) {
  const { t } = useI18n();

  return (
    <nav aria-label="Settings sections" className="min-h-0 flex-1 overflow-y-auto px-2 py-3">
      <div className="space-y-3">
        {settingsSectionGroups.map((group) => (
          <div key={group.labelKey} className="space-y-1">
            <div className="flex items-center gap-2 px-2 pt-1">
              <span className="theme-text-subtle text-[10px] font-semibold uppercase tracking-wide">
                {t(group.labelKey)}
              </span>
              <span className="h-px min-w-4 flex-1 bg-[var(--surface-border)]" />
            </div>
            {group.sections.map((section) => {
              const active = activeSection === section.id;
              return (
                <button
                  key={section.id}
                  type="button"
                  onClick={() => onSelect(section.id)}
                  className={cn(
                    "w-full rounded-lg px-3 py-1.5 text-left transition-colors",
                    active
                      ? "bg-[rgba(var(--accent-primary),0.14)] text-[var(--text-primary)]"
                      : "theme-text-secondary hover:bg-[var(--surface-hover)] hover:text-[var(--text-primary)]"
                  )}
                  aria-current={active ? "page" : undefined}
                >
                  <span className="block truncate text-[13px] font-medium leading-5">
                    {t(section.labelKey)}
                  </span>
                </button>
              );
            })}
          </div>
        ))}
      </div>
    </nav>
  );
}
