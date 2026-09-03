import { Text, View } from "react-native";
import { botAvatarColors, botAvatarInitials } from "./dashboardBots";
import { botStyles as styles } from "./dashboardBotsStyles";

export function BotAvatar({ id, name, size = 40 }: { id: string; name: string; size?: number }) {
  const [from, to] = botAvatarColors(id);
  return (
    <View
      style={[
        styles.avatar,
        {
          width: size,
          height: size,
          borderRadius: size * 0.34,
          backgroundColor: from,
          borderColor: to,
        },
      ]}
    >
      <Text style={[styles.avatarText, { fontSize: Math.max(10, size * 0.32) }]}>
        {botAvatarInitials(name)}
      </Text>
    </View>
  );
}
