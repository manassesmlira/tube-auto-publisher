const express = require('express');
const { google } = require('googleapis');
require('dotenv').config();

const app = express();
const PORT = 3333;

// Configuração OAuth2
const oauth2Client = new google.auth.OAuth2(
    process.env.GOOGLE_CLIENT_ID,
    process.env.GOOGLE_CLIENT_SECRET,
    'http://localhost:3333/oauth/callback'
);

// Scopes necessários
const SCOPES = [
    'https://www.googleapis.com/auth/youtube.upload',
    'https://www.googleapis.com/auth/drive.readonly'
];

// Rota principal
app.get('/auth', (req, res) => {
    const authUrl = oauth2Client.generateAuthUrl({
        access_type: 'offline',
        scope: SCOPES,
        prompt: 'consent'
    });
    
    res.send(`
        <html>
            <head>
                <title>Auto Publisher - Autorização</title>
                <style>
                    body { font-family: Arial; padding: 50px; text-align: center; }
                    .container { max-width: 600px; margin: 0 auto; }
                    .auth-link { 
                        display: inline-block; 
                        padding: 15px 30px; 
                        background: #4285f4; 
                        color: white; 
                        text-decoration: none; 
                        border-radius: 5px; 
                        margin: 20px 0;
                    }
                    .auth-link:hover { background: #3367d6; }
                </style>
            </head>
            <body>
                <div class="container">
                    <h1>🔐 Auto Publisher - Autorização</h1>
                    <p>Clique no botão abaixo para autorizar o acesso ao YouTube:</p>
                    <a href="${authUrl}" class="auth-link">🚀 Autorizar Aplicação</a>
                    <p><small>Após autorizar, você será redirecionado de volta automaticamente.</small></p>
                </div>
            </body>
        </html>
    `);
});

// Rota de callback
app.get('/oauth/callback', async (req, res) => {
    const { code } = req.query;
    
    if (!code) {
        return res.send(`
            <html>
                <body style="font-family: Arial; padding: 50px; text-align: center;">
                    <h1>❌ Erro</h1>
                    <p>Código de autorização não recebido.</p>
                    <a href="/auth">Tentar novamente</a>
                </body>
            </html>
        `);
    }
    
    try {
        console.log('🔄 Trocando código por tokens...');
        
        // Trocar código por tokens
        const { tokens } = await oauth2Client.getToken(code);
        
        console.log('✅ Tokens recebidos:', {
            access_token: tokens.access_token ? '✅ Sim' : '❌ Não',
            refresh_token: tokens.refresh_token ? '✅ Sim' : '❌ Não',
            expires_in: tokens.expiry_date
        });
        
        if (!tokens.refresh_token) {
            throw new Error('Refresh token não recebido. Tente revogar o acesso e autorizar novamente.');
        }
        
        // Exibir resultado
        res.send(`
            <html>
                <head>
                    <title>Sucesso!</title>
                    <style>
                        body { font-family: Arial; padding: 50px; text-align: center; }
                        .container { max-width: 800px; margin: 0 auto; }
                        .token { 
                            background: #f5f5f5; 
                            padding: 15px; 
                            border-radius: 5px; 
                            word-break: break-all; 
                            margin: 10px 0;
                            text-align: left;
                        }
                        .success { color: #28a745; }
                    </style>
                </head>
                <body>
                    <div class="container">
                        <h1 class="success">🎉 Autorização Bem-sucedida!</h1>
                        <p>Copie o refresh token abaixo e adicione ao seu arquivo .env:</p>
                        
                        <h3>🔑 GOOGLE_REFRESH_TOKEN:</h3>
                        <div class="token">${tokens.refresh_token}</div>
                        
                        <h3>📝 Adicione esta linha ao seu .env:</h3>
                        <div class="token">GOOGLE_REFRESH_TOKEN=${tokens.refresh_token}</div>
                        
                        <p><strong>✅ Configuração concluída!</strong></p>
                        <p>Agora você pode fechar esta janela e parar o servidor (Ctrl+C).</p>
                    </div>
                </body>
            </html>
        `);
        
        // Log no terminal
        console.log('\n🎉 SUCESSO! Adicione esta linha ao seu .env:');
        console.log(`GOOGLE_REFRESH_TOKEN=${tokens.refresh_token}`);
        console.log('\n✅ Configuração OAuth2 concluída!');
        
    } catch (error) {
        console.error('❌ Erro ao obter tokens:', error.message);
        
        res.send(`
            <html>
                <body style="font-family: Arial; padding: 50px; text-align: center;">
                    <h1>❌ Erro na Autorização</h1>
                    <p>${error.message}</p>
                    <a href="/auth">Tentar novamente</a>
                </body>
            </html>
        `);
    }
});

// Iniciar servidor
app.listen(PORT, () => {
    console.log(`🚀 Servidor rodando em http://localhost:${PORT}`);
    console.log(`🔗 Acesse: http://localhost:${PORT}/auth`);
    
    // Gerar URL direta
    const authUrl = oauth2Client.generateAuthUrl({
        access_type: 'offline',
        scope: SCOPES,
        prompt: 'consent'
    });
    
    console.log(`🔗 Ou acesse diretamente: ${authUrl}`);
});
