import React from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";

interface MobileErrorBoundaryProps {
  children: React.ReactNode;
}

interface MobileErrorBoundaryState {
  failed: boolean;
}

export class MobileErrorBoundary extends React.Component<
  MobileErrorBoundaryProps,
  MobileErrorBoundaryState
> {
  state: MobileErrorBoundaryState = { failed: false };

  static getDerivedStateFromError(): MobileErrorBoundaryState {
    return { failed: true };
  }

  private reset = (): void => {
    this.setState({ failed: false });
  };

  render(): React.ReactNode {
    if (!this.state.failed) return this.props.children;
    return (
      <View accessibilityRole="alert" style={styles.container}>
        <Text style={styles.title}>Cybara needs to reload this view</Text>
        <Text style={styles.detail}>Your gateway data and chat history remain available.</Text>
        <Pressable accessibilityRole="button" onPress={this.reset} style={styles.button}>
          <Text style={styles.buttonText}>Try again</Text>
        </Pressable>
      </View>
    );
  }
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    gap: 12,
    padding: 28,
    backgroundColor: "#111315",
  },
  title: {
    color: "#f5f5f5",
    fontSize: 20,
    fontWeight: "700",
    textAlign: "center",
  },
  detail: {
    color: "#a8adb4",
    fontSize: 15,
    textAlign: "center",
  },
  button: {
    minHeight: 44,
    justifyContent: "center",
    paddingHorizontal: 18,
    borderRadius: 8,
    backgroundColor: "#f5f5f5",
  },
  buttonText: {
    color: "#111315",
    fontSize: 15,
    fontWeight: "700",
  },
});
