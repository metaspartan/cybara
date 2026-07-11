import { useEffect, useMemo, useState } from "react";
import { Text, View } from "react-native";
import type { CybaraMobileApi, JourneyEvent, JourneyResponse } from "../lib/api";
import { colors } from "../theme/liquidGlass";
import { SettingsSection, StableDetailPanel } from "./dashboardControls";
import { EmptyState, LoadingState } from "./dashboardPrimitives";
import { styles } from "./dashboardStyles";

function journeyRelativeTime(ms: number): string {
  if (!ms) return "unknown";
  const diff = Date.now() - ms;
  const mins = Math.floor(diff / 60_000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 30) return `${days}d ago`;
  return new Date(ms).toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

function journeyDayKey(ms: number): string {
  if (!ms) return "Undated";
  return new Date(ms).toLocaleDateString(undefined, {
    weekday: "long",
    month: "long",
    day: "numeric",
    year: "numeric",
  });
}

function groupJourneyEvents(
  events: JourneyEvent[]
): Array<{ day: string; events: JourneyEvent[] }> {
  const groups = new Map<string, JourneyEvent[]>();
  for (const event of events) {
    const day = journeyDayKey(event.createdAtMs);
    const group = groups.get(day);
    if (group) group.push(event);
    else groups.set(day, [event]);
  }
  return [...groups].map(([day, groupedEvents]) => ({ day, events: groupedEvents }));
}

export function JourneyPanel({ accentColor, api }: { accentColor: string; api: CybaraMobileApi }) {
  const [journey, setJourney] = useState<JourneyResponse | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let mounted = true;
    const load = async () => {
      try {
        const result = await api.journey();
        if (mounted) {
          setJourney(result);
          setError(null);
        }
      } catch (loadError) {
        if (mounted) {
          setError(loadError instanceof Error ? loadError.message : "Failed to load journey");
        }
      }
    };
    void load();
    const interval = setInterval(load, 15_000);
    return () => {
      mounted = false;
      clearInterval(interval);
    };
  }, [api]);

  const groups = useMemo(() => groupJourneyEvents(journey?.events ?? []), [journey?.events]);

  return (
    <StableDetailPanel>
      {!journey && !error ? (
        <LoadingState label="Loading journey" detail="Fetching memories and learned skills." />
      ) : null}
      {journey ? (
        <SettingsSection title="Journey">
          <Text style={styles.journeySummaryText}>
            Everything your agent has learned, grouped by saved memories and skills.
          </Text>
          <View style={styles.journeyStatGrid}>
            <View style={styles.journeyStatCard}>
              <Text style={styles.gatewayDetailLabel}>Skills</Text>
              <Text style={[styles.gatewayDetailValue, { color: colors.cyan }]}>
                {journey.counts.skills}
              </Text>
            </View>
            <View style={styles.journeyStatCard}>
              <Text style={styles.gatewayDetailLabel}>Memories</Text>
              <Text style={[styles.gatewayDetailValue, { color: accentColor }]}>
                {journey.counts.memories}
              </Text>
            </View>
            <View style={styles.journeyStatCard}>
              <Text style={styles.gatewayDetailLabel}>Total</Text>
              <Text style={styles.gatewayDetailValue}>{journey.counts.total}</Text>
            </View>
          </View>
        </SettingsSection>
      ) : null}
      {error ? <Text style={styles.errorText}>{error}</Text> : null}
      {journey && journey.events.length === 0 && !error ? (
        <EmptyState label="No learning yet" detail="Saved skills and memories will appear here." />
      ) : null}
      {groups.map((group) => (
        <SettingsSection key={group.day} title={group.day}>
          {group.events.map((event, index) => (
            <View
              key={event.id}
              style={[
                styles.journeyEventRow,
                index === group.events.length - 1 && styles.journeyEventRowLast,
              ]}
            >
              <View style={styles.journeyEventMarkerRail}>
                <View
                  style={[
                    styles.journeyEventMarker,
                    { backgroundColor: event.kind === "skill" ? colors.cyan : accentColor },
                  ]}
                />
              </View>
              <View style={styles.journeyEventContent}>
                <View style={styles.journeyEventHeader}>
                  <Text style={styles.journeyEventTitle} numberOfLines={2}>
                    {event.title}
                  </Text>
                  <Text style={styles.journeyEventTime}>
                    {journeyRelativeTime(event.createdAtMs)}
                  </Text>
                </View>
                {event.detail && event.detail !== event.title ? (
                  <Text style={styles.journeyEventDetail} numberOfLines={3}>
                    {event.detail}
                  </Text>
                ) : null}
                <Text
                  style={[
                    styles.journeyEventMeta,
                    { color: event.kind === "skill" ? colors.cyan : accentColor },
                  ]}
                  numberOfLines={1}
                >
                  {event.kind}
                  {event.category ? ` · ${event.category}` : ""}
                </Text>
              </View>
            </View>
          ))}
        </SettingsSection>
      ))}
    </StableDetailPanel>
  );
}
