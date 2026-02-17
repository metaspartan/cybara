import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { Cloud, Bot, CheckCircle, ChevronRight, Key, Loader2, AlertCircle } from 'lucide-react';
import { Card, CardContent } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { useProviders, useAgents, useAvailableProviders, useCreateProvider, useCreateDefaultAgent } from '@/hooks/useApi';
import { setupApi } from '@/lib/api';
import type { AvailableProvider } from '@/types';

type WizardStep = 'welcome' | 'provider' | 'apikey' | 'oauth' | 'agent' | 'complete';

// Helper to determine what auth flow a provider needs
function getAuthFlow(provider: AvailableProvider): 'api_key' | 'oauth' | 'none' {
    if (!provider.authType || provider.authType === 'none') return 'none';
    if (provider.authType === 'oauth' || provider.authType === 'aws-sdk') return 'oauth';
    return 'api_key'; // api_key, bearer, token
}

export function Setup() {
    const navigate = useNavigate();
    const [step, setStep] = useState<WizardStep>('welcome');
    const [selectedProvider, setSelectedProvider] = useState<AvailableProvider | null>(null);
    const [apiKey, setApiKey] = useState('');
    const [isLoading, setIsLoading] = useState(false);
    const [error, setError] = useState<string | null>(null);

    const { data: providers, isLoading: providersLoading } = useProviders();
    const { data: agents, isLoading: agentsLoading } = useAgents();
    const { data: availableProviders, isLoading: availableLoading } = useAvailableProviders();
    const createProvider = useCreateProvider();
    const createDefaultAgent = useCreateDefaultAgent();

    // Skip wizard if already set up
    useEffect(() => {
        if (!providersLoading && !agentsLoading) {
            if (providers && providers.length > 0 && agents && agents.length > 0) {
                navigate('/');
            }
        }
    }, [providers, agents, providersLoading, agentsLoading, navigate]);

    const handleProviderSelect = (provider: AvailableProvider) => {
        setSelectedProvider(provider);
        setError(null);

        const authFlow = getAuthFlow(provider);

        if (authFlow === 'api_key') {
            setStep('apikey');
        } else if (authFlow === 'oauth') {
            // OAuth providers need special handling - can't be fully set up in wizard
            setStep('oauth');
        } else {
            // No auth needed (e.g., Ollama) - create directly
            handleCreateProvider(provider.id, '');
        }
    };

    const handleCreateProvider = async (providerId: string, key: string) => {
        setIsLoading(true);
        setError(null);
        try {
            await createProvider.mutateAsync({
                provider: providerId,
                name: selectedProvider?.name || providerId,
                api_key: key || undefined,
                is_default: true,
            });
            setStep('agent');
        } catch (err) {
            setError(err instanceof Error ? err.message : 'Failed to create provider');
        } finally {
            setIsLoading(false);
        }
    };

    const handleSkipOAuth = () => {
        // For OAuth providers, create a placeholder entry without credentials
        // User will need to complete OAuth flow in Settings later
        if (selectedProvider) {
            handleCreateProvider(selectedProvider.id, '');
        }
    };

    const handleCreateAgent = async () => {
        setIsLoading(true);
        setError(null);
        try {
            await createDefaultAgent.mutateAsync();
            await completeSetup();
        } catch (err) {
            // Agent might already exist, that's okay
            await completeSetup();
        }
    };

    const handleSkipAgent = async () => {
        await completeSetup();
    };

    const completeSetup = async () => {
        try {
            const result = await setupApi.complete();
            if (!result.success || !result.data?.success) {
                throw new Error(result.error || 'Failed to complete setup');
            }
            setStep('complete');
        } catch (err) {
            setError('Failed to complete setup');
        } finally {
            setIsLoading(false);
        }
    };

    const handleGoToDashboard = () => {
        navigate('/');
    };

    if (providersLoading || agentsLoading) {
        return (
            <div className="min-h-screen bg-[#0a0a0f] flex items-center justify-center">
                <Loader2 className="w-8 h-8 text-indigo-500 animate-spin" />
            </div>
        );
    }

    return (
        <div className="min-h-screen w-full bg-[#0a0a0f] flex items-center justify-center">
            <div className="w-full max-w-xl mx-auto px-4">
                {/* Progress indicator */}
                <div className="flex items-center justify-center gap-2 mb-8">
                    {['welcome', 'provider', 'apikey', 'agent', 'complete'].map((s, i) => (
                        <div key={s} className="flex items-center">
                            <div className={`w-3 h-3 rounded-full transition-colors ${step === s || (step === 'oauth' && s === 'apikey') ? 'bg-indigo-500' :
                                    ['welcome', 'provider', 'apikey', 'agent', 'complete'].indexOf(step) > i ||
                                        (step === 'oauth' && i < 2) ? 'bg-emerald-500' :
                                        'bg-white/20'
                                }`} />
                            {i < 4 && <div className={`w-8 h-0.5 ${['welcome', 'provider', 'apikey', 'agent', 'complete'].indexOf(step) > i ||
                                    (step === 'oauth' && i < 2) ? 'bg-emerald-500' : 'bg-white/20'
                                }`} />}
                        </div>
                    ))}
                </div>

                <Card className="backdrop-blur-xl bg-white/5 border-white/10">
                    <CardContent className="p-8">
                        {/* Welcome Step */}
                        {step === 'welcome' && (
                            <div className="text-center space-y-6">
                                <div className="w-20 h-20 mx-auto flex items-center justify-center">
                                    <img
                                        src="/cybara.png"
                                        alt="Cybara"
                                        className={'w-full h-full object-cover transition-all duration-300'}
                                    />
                                </div>
                                <div>
                                    <h1 className="text-3xl font-bold text-white mb-2">Welcome to Cybara!</h1>
                                    <p className="text-gray-400 text-lg">Let's get you set up in just a few steps</p>
                                </div>
                                <div className="text-left space-y-3 py-4">
                                    <div className="flex items-center gap-3 text-gray-300">
                                        <Cloud className="w-5 h-5 text-indigo-400 shrink-0" />
                                        <span>Connect an AI provider</span>
                                    </div>
                                    <div className="flex items-center gap-3 text-gray-300">
                                        <Bot className="w-5 h-5 text-indigo-400 shrink-0" />
                                        <span>Create your first AI agent</span>
                                    </div>
                                    <div className="flex items-center gap-3 text-gray-300">
                                        <CheckCircle className="w-5 h-5 text-indigo-400 shrink-0" />
                                        <span>Start chatting and building</span>
                                    </div>
                                </div>
                                <Button size="lg" onClick={() => setStep('provider')} className="w-full">
                                    Get Started <ChevronRight className="w-5 h-5 ml-2" />
                                </Button>
                            </div>
                        )}

                        {/* Provider Selection Step */}
                        {step === 'provider' && (
                            <div className="space-y-6">
                                <div className="text-center">
                                    <h2 className="text-2xl font-bold text-white mb-2">Choose AI Provider</h2>
                                    <p className="text-gray-400">Select which AI service to connect</p>
                                </div>
                                {availableLoading ? (
                                    <div className="flex justify-center py-8">
                                        <Loader2 className="w-6 h-6 text-indigo-500 animate-spin" />
                                    </div>
                                ) : (
                                    <div className="grid grid-cols-2 gap-2 max-h-80 overflow-y-auto pr-1">
                                        {availableProviders?.map((provider) => {
                                            const authFlow = getAuthFlow(provider);
                                            return (
                                                <button
                                                    key={provider.id}
                                                    onClick={() => handleProviderSelect(provider)}
                                                    className="px-3 py-2.5 rounded-lg bg-white/5 border border-white/10 hover:border-indigo-500/50 hover:bg-indigo-500/10 transition-all text-center group relative"
                                                >
                                                    <span className="font-medium text-sm text-white group-hover:text-indigo-300 transition-colors">
                                                        {provider.name}
                                                    </span>
                                                    {authFlow === 'none' && (
                                                        <span className="absolute top-1 right-1 text-[10px] bg-emerald-500/20 text-emerald-400 px-1 rounded">
                                                            Local
                                                        </span>
                                                    )}
                                                    {authFlow === 'oauth' && (
                                                        <span className="absolute top-1 right-1 text-[10px] bg-amber-500/20 text-amber-400 px-1 rounded">
                                                            OAuth
                                                        </span>
                                                    )}
                                                </button>
                                            );
                                        })}
                                    </div>
                                )}
                            </div>
                        )}

                        {/* API Key Step */}
                        {step === 'apikey' && selectedProvider && (
                            <div className="space-y-6">
                                <div className="text-center">
                                    <div className="w-16 h-16 mx-auto mb-4 rounded-xl bg-gradient-to-br from-amber-500 to-orange-600 flex items-center justify-center">
                                        <Key className="w-8 h-8 text-white" />
                                    </div>
                                    <h2 className="text-2xl font-bold text-white mb-2">Enter API Key</h2>
                                    <p className="text-gray-400">Add your {selectedProvider.name} API key</p>
                                </div>

                                <div className="space-y-4">
                                    <Input
                                        type="password"
                                        placeholder="sk-... or your API key"
                                        value={apiKey}
                                        onChange={(e) => setApiKey(e.target.value)}
                                        className="text-lg"
                                    />

                                    {error && (
                                        <p className="text-red-400 text-sm text-center">{error}</p>
                                    )}

                                    <div className="flex gap-3">
                                        <Button variant="ghost" onClick={() => setStep('provider')} className="flex-1">
                                            Back
                                        </Button>
                                        <Button
                                            onClick={() => handleCreateProvider(selectedProvider.id, apiKey)}
                                            disabled={!apiKey.trim() || isLoading}
                                            isLoading={isLoading}
                                            className="flex-1"
                                        >
                                            Continue
                                        </Button>
                                    </div>
                                </div>
                            </div>
                        )}

                        {/* OAuth Step - for providers that need OAuth flow */}
                        {step === 'oauth' && selectedProvider && (
                            <div className="space-y-6">
                                <div className="text-center">
                                    <div className="w-16 h-16 mx-auto mb-4 rounded-xl bg-gradient-to-br from-blue-500 to-cyan-600 flex items-center justify-center">
                                        <AlertCircle className="w-8 h-8 text-white" />
                                    </div>
                                    <h2 className="text-2xl font-bold text-white mb-2">OAuth Required</h2>
                                    <p className="text-gray-400">{selectedProvider.name} requires OAuth authentication</p>
                                </div>

                                <div className="p-4 rounded-xl bg-amber-500/10 border border-amber-500/30">
                                    <p className="text-sm text-amber-200">
                                        This provider uses OAuth for authentication. After setup, go to <strong>Settings → Providers</strong> to complete the OAuth flow.
                                    </p>
                                </div>

                                {error && (
                                    <p className="text-red-400 text-sm text-center">{error}</p>
                                )}

                                <div className="flex gap-3">
                                    <Button variant="ghost" onClick={() => setStep('provider')} className="flex-1">
                                        Back
                                    </Button>
                                    <Button
                                        onClick={handleSkipOAuth}
                                        isLoading={isLoading}
                                        className="flex-1"
                                    >
                                        Continue Anyway
                                    </Button>
                                </div>
                            </div>
                        )}

                        {/* Agent Creation Step */}
                        {step === 'agent' && (
                            <div className="space-y-6">
                                <div className="text-center">
                                    <div className="w-16 h-16 mx-auto mb-4 rounded-xl bg-gradient-to-br from-emerald-500 to-teal-600 flex items-center justify-center">
                                        <Bot className="w-8 h-8 text-white" />
                                    </div>
                                    <h2 className="text-2xl font-bold text-white mb-2">Create Your Agent</h2>
                                    <p className="text-gray-400">Set up a default AI assistant</p>
                                </div>

                                <div className="p-4 rounded-xl bg-white/5 border border-white/10">
                                    <h3 className="font-medium text-white mb-1">Default Agent</h3>
                                    <p className="text-sm text-gray-400">
                                        A general-purpose AI assistant ready to help with coding, questions, and tasks.
                                    </p>
                                </div>

                                {error && (
                                    <p className="text-red-400 text-sm text-center">{error}</p>
                                )}

                                <div className="flex gap-3">
                                    <Button variant="ghost" onClick={handleSkipAgent} className="flex-1">
                                        Skip for Now
                                    </Button>
                                    <Button
                                        onClick={handleCreateAgent}
                                        isLoading={isLoading}
                                        className="flex-1"
                                    >
                                        Create Agent
                                    </Button>
                                </div>
                            </div>
                        )}

                        {/* Complete Step */}
                        {step === 'complete' && (
                            <div className="text-center space-y-6">
                                <div className="w-20 h-20 mx-auto rounded-2xl bg-gradient-to-br from-emerald-500 to-teal-600 flex items-center justify-center">
                                    <CheckCircle className="w-10 h-10 text-white" />
                                </div>
                                <div>
                                    <h1 className="text-3xl font-bold text-white mb-2">You're All Set! 🎉</h1>
                                    <p className="text-gray-400 text-lg">Cybara is ready to use</p>
                                </div>
                                <Button size="lg" onClick={handleGoToDashboard} className="w-full">
                                    Go to Dashboard <ChevronRight className="w-5 h-5 ml-2" />
                                </Button>
                            </div>
                        )}
                    </CardContent>
                </Card>
            </div>
        </div>
    );
}
