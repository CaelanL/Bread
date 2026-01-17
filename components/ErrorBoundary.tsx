import React from 'react';
import { View, Text, Pressable, StyleSheet } from 'react-native';
import { IconSymbol } from '@/components/ui/icon-symbol';

interface ErrorBoundaryProps {
  children: React.ReactNode;
}

interface ErrorBoundaryState {
  hasError: boolean;
  error: Error | null;
}

/**
 * Error Boundary - catches render errors and shows fallback UI
 * Prevents white screen of death when components crash
 */
export class ErrorBoundary extends React.Component<ErrorBoundaryProps, ErrorBoundaryState> {
  constructor(props: ErrorBoundaryProps) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, errorInfo: React.ErrorInfo) {
    // Log error in development
    if (__DEV__) {
      console.error('[ErrorBoundary] Caught error:', error);
      console.error('[ErrorBoundary] Component stack:', errorInfo.componentStack);
    }
    // TODO: In production, send to error reporting service (Sentry, etc.)
  }

  handleRetry = () => {
    this.setState({ hasError: false, error: null });
  };

  render() {
    if (this.state.hasError) {
      return (
        <View style={styles.container}>
          <View style={styles.content}>
            <View style={styles.iconContainer}>
              <IconSymbol name="exclamationmark.triangle.fill" size={48} color="#ef4444" />
            </View>
            <Text style={styles.title}>Something went wrong</Text>
            <Text style={styles.message}>
              The app encountered an unexpected error. Please try again.
            </Text>
            {__DEV__ && this.state.error && (
              <Text style={styles.errorDetail}>
                {this.state.error.message}
              </Text>
            )}
            <Pressable style={styles.button} onPress={this.handleRetry}>
              <IconSymbol name="arrow.clockwise" size={18} color="#ffffff" />
              <Text style={styles.buttonText}>Try Again</Text>
            </Pressable>
          </View>
        </View>
      );
    }

    return this.props.children;
  }
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#1a1a1a',
    justifyContent: 'center',
    alignItems: 'center',
    padding: 24,
  },
  content: {
    alignItems: 'center',
    maxWidth: 300,
  },
  iconContainer: {
    width: 80,
    height: 80,
    borderRadius: 40,
    backgroundColor: 'rgba(239,68,68,0.15)',
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: 24,
  },
  title: {
    fontSize: 22,
    fontWeight: '700',
    color: '#f5f5f5',
    marginBottom: 12,
    textAlign: 'center',
  },
  message: {
    fontSize: 15,
    color: '#9a9a9a',
    textAlign: 'center',
    lineHeight: 22,
    marginBottom: 24,
  },
  errorDetail: {
    fontSize: 12,
    color: '#ef4444',
    textAlign: 'center',
    marginBottom: 24,
    fontFamily: 'monospace',
  },
  button: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    backgroundColor: '#c9a962',
    paddingHorizontal: 24,
    paddingVertical: 14,
    borderRadius: 12,
  },
  buttonText: {
    fontSize: 16,
    fontWeight: '600',
    color: '#ffffff',
  },
});
