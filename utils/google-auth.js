const { google } = require('googleapis');
const fs = require('fs');
const path = require('path');
require('dotenv').config();

/**
 * Configuração de autenticação Google OAuth2
 */
class GoogleAuth {
    constructor() {
        this.oauth2Client = null;
        this.isAuthenticated = false;
        this.scopes = [
            'https://www.googleapis.com/auth/youtube.upload',
            'https://www.googleapis.com/auth/youtube.readonly',
            'https://www.googleapis.com/auth/drive.readonly',
            'https://www.googleapis.com/auth/drive.metadata.readonly'
        ];
        
        this.initializeAuth();
    }
    
    /**
     * Inicializa o cliente OAuth2
     */
    initializeAuth() {
        try {
            console.log('🔐 Inicializando autenticação Google...');
            
            // Validar variáveis de ambiente
            this.validateEnvironmentVariables();
            
            // Criar cliente OAuth2
            this.oauth2Client = new google.auth.OAuth2(
                process.env.GOOGLE_CLIENT_ID,
                process.env.GOOGLE_CLIENT_SECRET,
                this.getRedirectUri()
            );
            
            // Configurar refresh token se disponível
            if (process.env.GOOGLE_REFRESH_TOKEN) {
                this.setRefreshToken(process.env.GOOGLE_REFRESH_TOKEN);
                console.log('✅ Refresh token configurado');
            } else {
                console.warn('⚠️ Refresh token não encontrado');
            }
            
        } catch (error) {
            console.error('❌ Erro na inicialização:', error.message);
            throw error;
        }
    }
    
    /**
     * Valida se todas as variáveis necessárias estão configuradas
     */
    validateEnvironmentVariables() {
        const required = [
            'GOOGLE_CLIENT_ID',
            'GOOGLE_CLIENT_SECRET'
        ];
        
        const missing = required.filter(key => !process.env[key]);
        
        if (missing.length > 0) {
            throw new Error(`❌ Variáveis de ambiente faltando: ${missing.join(', ')}`);
        }
        
        // Validar formato do Client ID
        if (!process.env.GOOGLE_CLIENT_ID.includes('.apps.googleusercontent.com')) {
            throw new Error('❌ GOOGLE_CLIENT_ID parece estar inválido');
        }
        
        console.log('✅ Variáveis de ambiente validadas');
    }
    
    /**
     * Retorna URI de redirecionamento baseado no ambiente
     */
    getRedirectUri() {
        if (process.env.NODE_ENV === 'production') {
            const renderUrl = process.env.RENDER_EXTERNAL_URL || 'https://auto-publisher.onrender.com';
            return `${renderUrl}/oauth/callback`;
        }
        return 'http://localhost:3333/oauth/callback';
    }
    
    /**
     * Configura o refresh token
     * @param {string} refreshToken - Token de atualização
     */
    setRefreshToken(refreshToken) {
        try {
            this.oauth2Client.setCredentials({
                refresh_token: refreshToken
            });
            
            this.isAuthenticated = true;
            console.log('🔑 Credenciais configuradas com sucesso');
            
        } catch (error) {
            console.error('❌ Erro ao configurar refresh token:', error.message);
            throw error;
        }
    }
    
    /**
     * Gera URL de autorização para obter tokens iniciais
     * @returns {string} - URL de autorização
     */
    generateAuthUrl() {
        try {
            const authUrl = this.oauth2Client.generateAuthUrl({
                access_type: 'offline',
                scope: this.scopes,
                prompt: 'consent',
                include_granted_scopes: true
            });
            
            console.log('🔗 URL de autorização gerada');
            return authUrl;
            
        } catch (error) {
            console.error('❌ Erro ao gerar URL:', error.message);
            throw error;
        }
    }
    
    /**
     * Troca código de autorização por tokens
     * @param {string} code - Código de autorização
     * @returns {Object} - Tokens obtidos
     */
    async exchangeCodeForTokens(code) {
        try {
            console.log('🔄 Trocando código por tokens...');
            
            const { tokens } = await this.oauth2Client.getAccessToken(code);
            
            // Validar se refresh token foi retornado
            if (!tokens.refresh_token) {
                throw new Error('❌ Refresh token não foi retornado (pode já estar autorizado)');
            }
            
            // Configurar tokens no cliente
            this.oauth2Client.setCredentials(tokens);
            this.isAuthenticated = true;
            
            console.log('✅ Tokens obtidos com sucesso');
            console.log('🔑 Access Token:', tokens.access_token ? 'Presente' : 'Ausente');
            console.log('🔄 Refresh Token:', tokens.refresh_token ? 'Presente' : 'Ausente');
            
            return tokens;
            
        } catch (error) {
            console.error('❌ Erro ao trocar código:', error.message);
            throw error;
        }
    }
    
    /**
     * Atualiza access token usando refresh token
     */
    async refreshAccessToken() {
        try {
            console.log('🔄 Atualizando access token...');
            
            if (!this.oauth2Client.credentials.refresh_token) {
                throw new Error('❌ Refresh token não configurado');
            }
            
            const { credentials } = await this.oauth2Client.refreshAccessToken();
            this.oauth2Client.setCredentials(credentials);
            
            console.log('✅ Access token atualizado');
            return credentials;
            
        } catch (error) {
            console.error('❌ Erro ao atualizar token:', error.message);
            throw error;
        }
    }
    
    /**
     * Verifica se a autenticação está válida
     * @returns {boolean} - Status da autenticação
     */
    async validateAuthentication() {
        try {
            if (!this.isAuthenticated || !this.oauth2Client.credentials.refresh_token) {
                console.log('⚠️ Não autenticado');
                return false;
            }
            
            // Tentar fazer uma chamada simples para validar
            const oauth2 = google.oauth2({ version: 'v2', auth: this.oauth2Client });
            const response = await oauth2.userinfo.get();
            
            if (response.data.email) {
                console.log('✅ Autenticação válida para:', response.data.email);
                return true;
            }
            
            return false;
            
        } catch (error) {
            console.error('❌ Erro na validação:', error.message);
            
            // Se token expirou, tentar renovar
            if (error.code === 401) {
                try {
                    await this.refreshAccessToken();
                    return await this.validateAuthentication();
                } catch (refreshError) {
                    console.error('❌ Erro ao renovar token:', refreshError.message);
                    return false;
                }
            }
            
            return false;
        }
    }
    
    /**
     * Retorna cliente autenticado para YouTube API
     * @returns {Object} - Cliente YouTube
     */
    getYouTubeClient() {
        if (!this.isAuthenticated) {
            throw new Error('❌ Não autenticado para YouTube API');
        }
        
        return google.youtube({ version: 'v3', auth: this.oauth2Client });
    }
    
    /**
     * Retorna cliente autenticado para Drive API
     * @returns {Object} - Cliente Drive
     */
    getDriveClient() {
        if (!this.isAuthenticated) {
            throw new Error('❌ Não autenticado para Drive API');
        }
        
        return google.drive({ version: 'v3', auth: this.oauth2Client });
    }
    
    /**
     * Retorna informações do usuário autenticado
     */
    async getUserInfo() {
        try {
            const oauth2 = google.oauth2({ version: 'v2', auth: this.oauth2Client });
            const response = await oauth2.userinfo.get();
            
            return {
                email: response.data.email,
                name: response.data.name,
                picture: response.data.picture,
                verified_email: response.data.verified_email
            };
            
        } catch (error) {
            console.error('❌ Erro ao obter info do usuário:', error.message);
            throw error;
        }
    }
    
    /**
     * Retorna informações do canal YouTube
     */
    async getChannelInfo() {
        try {
            const youtube = this.getYouTubeClient();
            const response = await youtube.channels.list({
                part: ['snippet', 'statistics', 'brandingSettings'],
                mine: true
            });
            
            if (response.data.items.length === 0) {
                throw new Error('❌ Nenhum canal encontrado');
            }
            
            const channel = response.data.items[0];
            return {
                id: channel.id,
                title: channel.snippet.title,
                description: channel.snippet.description,
                customUrl: channel.snippet.customUrl,
                subscriberCount: parseInt(channel.statistics.subscriberCount),
                videoCount: parseInt(channel.statistics.videoCount),
                viewCount: parseInt(channel.statistics.viewCount),
                thumbnail: channel.snippet.thumbnails.default.url,
                country: channel.snippet.country
            };
            
        } catch (error) {
            console.error('❌ Erro ao obter info do canal:', error.message);
            throw error;
        }
    }
    
    /**
     * Testa conectividade com APIs Google
     */
    async testConnection() {
        try {
            console.log('🧪 Testando conexão com APIs Google...');
            
            // 1. Validar autenticação
            const isValid = await this.validateAuthentication();
            if (!isValid) {
                throw new Error('❌ Autenticação inválida');
            }
            
            // 2. Testar YouTube API
            const channelInfo = await this.getChannelInfo();
            console.log(`✅ YouTube API: Canal "${channelInfo.title}" (${channelInfo.subscriberCount} inscritos)`);
            
            // 3. Testar Drive API
            const drive = this.getDriveClient();
            const driveResponse = await drive.about.get({ fields: 'user' });
            console.log(`✅ Drive API: Usuário "${driveResponse.data.user.displayName}"`);
            
            // 4. Testar quota
            const quotaInfo = await this.checkQuotaUsage();
            console.log(`📊 Quota YouTube: ${quotaInfo.used}/${quotaInfo.limit} pontos`);
            
            return {
                success: true,
                youtube: channelInfo,
                drive: driveResponse.data.user,
                quota: quotaInfo
            };
            
        } catch (error) {
            console.error('❌ Erro no teste:', error.message);
            throw error;
        }
    }
    
    /**
     * Verifica uso de quota da API (estimado)
     */
    async checkQuotaUsage() {
        try {
            // YouTube API v3 tem limite de 10.000 pontos/dia
            // Esta é uma estimativa básica
            return {
                used: 'Unknown',
                limit: '10,000',
                resetTime: 'Midnight PST'
            };
            
        } catch (error) {
            console.warn('⚠️ Não foi possível verificar quota:', error.message);
            return {
                used: 'Error',
                limit: '10,000',
                resetTime: 'Unknown'
            };
        }
    }
    
    /**
     * Salva configuração em arquivo (para backup)
     */
    saveConfiguration() {
        try {
            const config = {
                client_id: process.env.GOOGLE_CLIENT_ID,
                redirect_uri: this.getRedirectUri(),
                scopes: this.scopes,
                created_at: new Date().toISOString()
            };
            
            const configPath = path.join(__dirname, '..', 'google-config.json');
            fs.writeFileSync(configPath, JSON.stringify(config, null, 2));
            
            console.log('💾 Configuração salva em:', configPath);
            
        } catch (error) {
            console.warn('⚠️ Erro ao salvar configuração:', error.message);
        }
    }
}

// Instância singleton
let authInstance = null;

/**
 * Retorna instância singleton da autenticação
 * @returns {GoogleAuth} - Instância de autenticação
 */
function getAuthInstance() {
    if (!authInstance) {
        authInstance = new GoogleAuth();
    }
    return authInstance;
}

/**
 * Inicializa autenticação (para uso direto)
 */
async function initializeAuthentication() {
    try {
        const auth = getAuthInstance();
        const isValid = await auth.validateAuthentication();
        
        if (!isValid) {
            throw new Error('❌ Autenticação não configurada ou inválida');
        }
        
        console.log('✅ Autenticação Google inicializada');
        return auth;
        
    } catch (error) {
        console.error('❌ Falha na inicialização:', error.message);
        throw error;
    }
}

module.exports = {
    GoogleAuth,
    getAuthInstance,
    initializeAuthentication
};

/*
🎯 PRINCIPAIS FUNCIONALIDADES:
🔐 AUTENTICAÇÃO COMPLETA:
OAuth2 configurado para YouTube + Drive
Refresh token automático quando expira
Validação de credenciais em tempo real
Múltiplos ambientes (local/produção)
🛡️ SEGURANÇA E VALIDAÇÃO:
✅ Validação de variáveis de ambiente
✅ Verificação de formatos de credenciais
✅ Renovação automática de tokens
✅ Tratamento de erros específicos
📊 MONITORAMENTO:
✅ Informações do usuário/canal
✅ Teste de conectividade APIs
✅ Verificação de quota (básica)
✅ Logs detalhados de status
🔧 RECURSOS AVANÇADOS:
✅ Singleton pattern para uma instância
✅ Configuração automática redirect URI
✅ Backup de configurações
✅ Suporte a múltiplos escopos
🚀 INTEGRAÇÃO:
✅ Clientes prontos para YouTube/Drive
✅ Métodos helper para outras funções
✅ Compatível com todos os scripts
*/