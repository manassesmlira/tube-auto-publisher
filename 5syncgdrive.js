const { google } = require('googleapis');
const { Client } = require('@notionhq/client');
require('dotenv').config();

// Configurações
const notion = new Client({ auth: process.env.NOTION_TOKEN });
const drive = google.drive('v3');

// Configurações padrão para novos vídeos
const DEFAULT_SETTINGS = {
    category: 'Education',
    privacy: 'Public',
    status: 'Pending',
    description: '', // Vazio, será preenchido manualmente
    tags: '' // Vazio, será preenchido manualmente
};

/**
 * Valida variáveis de ambiente
 */
function validateEnvironment() {
    const required = [
        'NOTION_TOKEN',
        'NOTION_DATABASE_ID',
        'GOOGLE_DRIVE_FOLDER_ID', // Nova variável
        'GOOGLE_CLIENT_ID',
        'GOOGLE_CLIENT_SECRET',
        'GOOGLE_REFRESH_TOKEN'
    ];
    
    const missing = required.filter(key => !process.env[key]);
    if (missing.length > 0) {
        throw new Error(`❌ Variáveis obrigatórias: ${missing.join(', ')}`);
    }
    
    console.log('✅ Variáveis de ambiente validadas');
}

/**
 * Autentica no Google Drive
 */
async function authenticateGoogleDrive() {
    try {
        console.log('🔐 Autenticando no Google Drive...');
        
        const oauth2Client = new google.auth.OAuth2(
            process.env.GOOGLE_CLIENT_ID,
            process.env.GOOGLE_CLIENT_SECRET
        );
        
        oauth2Client.setCredentials({
            refresh_token: process.env.GOOGLE_REFRESH_TOKEN
        });
        
        google.options({ auth: oauth2Client });
        
        // Testar conexão
        const testResponse = await drive.about.get({ fields: 'user' });
        console.log(`✅ Conectado como: ${testResponse.data.user.displayName}`);
        
        return oauth2Client;
    } catch (error) {
        console.error('❌ Erro na autenticação Google Drive:', error.message);
        throw error;
    }
}

/**
 * Lista vídeos da pasta do Google Drive
 */
async function getVideosFromDrive(folderId) {
    try {
        console.log('📁 Buscando vídeos no Google Drive...');
        console.log(`📂 Pasta ID: ${folderId}`);
        
        const response = await drive.files.list({
            q: `'${folderId}' in parents and mimeType contains 'video/' and trashed=false`,
            fields: 'files(id, name, mimeType, size, createdTime, modifiedTime, webViewLink)',
            orderBy: 'createdTime desc'
        });
        
        const videos = response.data.files || [];
        console.log(`📊 Encontrados ${videos.length} vídeo(s)`);
        
        // Processar cada vídeo
        const processedVideos = videos.map(video => {
            const shareableLink = `https://drive.google.com/file/d/${video.id}/view?usp=sharing`;
            const cleanName = video.name.replace(/\.[^/.]+$/, ""); // Remove extensão
            
            return {
                id: video.id,
                name: cleanName,
                originalName: video.name,
                mimeType: video.mimeType,
                size: parseInt(video.size) || 0,
                createdTime: video.createdTime,
                modifiedTime: video.modifiedTime,
                driveLink: shareableLink,
                webViewLink: video.webViewLink
            };
        });
        
        // Mostrar vídeos encontrados
        console.log('\n📋 Vídeos encontrados:');
        processedVideos.forEach((video, index) => {
            const sizeMB = (video.size / (1024 * 1024)).toFixed(2);
            console.log(`   ${index + 1}. 📺 ${video.name}`);
            console.log(`      📊 ${sizeMB} MB | 📅 ${new Date(video.createdTime).toLocaleString('pt-BR')}`);
            console.log(`      🔗 ${video.driveLink}`);
        });
        
        return processedVideos;
    } catch (error) {
        console.error('❌ Erro ao buscar vídeos do Drive:', error.message);
        throw error;
    }
}

/**
 * Obtém vídeos já existentes no Notion
 */
async function getExistingVideosFromNotion() {
    try {
        console.log('📋 Verificando vídeos existentes no Notion...');
        
        const response = await notion.databases.query({
            database_id: process.env.NOTION_DATABASE_ID,
            page_size: 100
        });
        
        const existingVideos = new Set();
        const existingLinks = new Set();
        
        response.results.forEach(page => {
            // Coletar títulos e links existentes
            const title = page.properties['Video Title']?.title?.[0]?.plain_text;
            const driveLink = page.properties['Drive Link']?.url;
            
            if (title) existingVideos.add(title.toLowerCase().trim());
            if (driveLink) existingLinks.add(driveLink);
        });
        
        console.log(`📊 ${existingVideos.size} vídeo(s) já existem no Notion`);
        
        return { existingVideos, existingLinks };
    } catch (error) {
        console.error('❌ Erro ao verificar Notion:', error.message);
        throw error;
    }
}

/**
 * Adiciona novo vídeo no Notion
 */
async function addVideoToNotion(video) {
    try {
        console.log(`➕ Adicionando: "${video.name}"`);
        
        const properties = {
            'Video Title': {
                title: [
                    {
                        text: {
                            content: video.name
                        }
                    }
                ]
            },
            'Drive Link': {
                url: video.driveLink
            },
            'Video Description': {
                rich_text: [
                    {
                        text: {
                            content: DEFAULT_SETTINGS.description
                        }
                    }
                ]
            },
            'Tags': {
                rich_text: [
                    {
                        text: {
                            content: DEFAULT_SETTINGS.tags
                        }
                    }
                ]
            },
            'Category': {
                select: {
                    name: DEFAULT_SETTINGS.category
                }
            },
            'Privacy': {
                select: {
                    name: DEFAULT_SETTINGS.privacy
                }
            },
            'Upload Status': {
                select: {
                    name: DEFAULT_SETTINGS.status
                }
            },
            'File Size (MB)': {
                number: Math.round(video.size / (1024 * 1024) * 100) / 100
            },
            'Drive Created': {
                date: {
                    start: video.createdTime
                }
            }
        };
        
        const response = await notion.pages.create({
            parent: {
                database_id: process.env.NOTION_DATABASE_ID
            },
            properties: properties
        });
        
        console.log(`   ✅ Adicionado com ID: ${response.id}`);
        return response;
    } catch (error) {
        console.error(`   ❌ Erro ao adicionar "${video.name}":`, error.message);
        throw error;
    }
}

/**
 * Sincroniza vídeos do Drive para o Notion
 */
async function syncVideos(folderId, options = {}) {
    try {
        console.log('🔄 INICIANDO SINCRONIZAÇÃO...');
        console.log('═'.repeat(50));
        
        const {
            dryRun = false,
            limit = null,
            skipExisting = true
        } = options;
        
        if (dryRun) {
            console.log('🔍 MODO PREVIEW - Nenhuma alteração será feita');
        }
        
        // 1. Buscar vídeos do Drive
        const driveVideos = await getVideosFromDrive(folderId);
        
        if (driveVideos.length === 0) {
            console.log('📭 Nenhum vídeo encontrado no Google Drive');
            return { added: 0, skipped: 0, errors: 0 };
        }
        
        // 2. Verificar existentes no Notion
        const { existingVideos, existingLinks } = await getExistingVideosFromNotion();
        
        // 3. Filtrar novos vídeos
        const newVideos = driveVideos.filter(video => {
            const nameExists = existingVideos.has(video.name.toLowerCase().trim());
            const linkExists = existingLinks.has(video.driveLink);
            
            if (skipExisting && (nameExists || linkExists)) {
                console.log(`⏭️ Pulando (já existe): "${video.name}"`);
                return false;
            }
            
            return true;
        });
        
        console.log(`\n🆕 ${newVideos.length} vídeo(s) novo(s) para adicionar`);
        
        if (newVideos.length === 0) {
            console.log('✅ Todos os vídeos já estão sincronizados!');
            return { added: 0, skipped: driveVideos.length, errors: 0 };
        }
        
        // 4. Aplicar limite se especificado
        const videosToAdd = limit ? newVideos.slice(0, limit) : newVideos;
        
        if (limit && newVideos.length > limit) {
            console.log(`📊 Limitando a ${limit} vídeo(s) por execução`);
        }
        
        // 5. Adicionar vídeos (ou preview)
        let added = 0;
        let errors = 0;
        
        console.log('\n📤 Processando vídeos...');
        
        for (const video of videosToAdd) {
            try {
                if (dryRun) {
                    console.log(`👁️ PREVIEW: Adicionaria "${video.name}"`);
                    added++;
                } else {
                    await addVideoToNotion(video);
                    added++;
                    
                    // Pequena pausa entre adições
                    await new Promise(resolve => setTimeout(resolve, 500));
                }
            } catch (error) {
                console.error(`❌ Erro em "${video.name}":`, error.message);
                errors++;
            }
        }
        
        // 6. Resumo final
        console.log('\n═'.repeat(50));
        console.log('✅ SINCRONIZAÇÃO CONCLUÍDA!');
        console.log(`📊 Estatísticas:`);
        console.log(`   ➕ Adicionados: ${added}`);
        console.log(`   ⏭️ Pulados: ${driveVideos.length - newVideos.length}`);
        console.log(`   ❌ Erros: ${errors}`);
        console.log(`   📁 Total no Drive: ${driveVideos.length}`);
        
        return {
            added,
            skipped: driveVideos.length - newVideos.length,
            errors,
            total: driveVideos.length
        };
        
    } catch (error) {
        console.error('💥 ERRO FATAL na sincronização:', error.message);
        throw error;
    }
}

/**
 * Função principal
 */
async function main() {
    try {
        console.log('🚀 GOOGLE DRIVE → NOTION SYNC');
        console.log('═'.repeat(50));
        
        // Validar ambiente
        validateEnvironment();
        
        // Autenticar Google Drive
        await authenticateGoogleDrive();
        
        // Obter ID da pasta do .env
        const folderId = process.env.GOOGLE_DRIVE_FOLDER_ID;
        
        // Processar argumentos da linha de comando
        const args = process.argv.slice(2);
        const options = {
            dryRun: args.includes('--preview') || args.includes('--dry-run'),
            limit: null,
            skipExisting: !args.includes('--force')
        };
        
        // Extrair limite se especificado
        const limitIndex = args.findIndex(arg => arg.startsWith('--limit='));
        if (limitIndex !== -1) {
            options.limit = parseInt(args[limitIndex].split('=')[1]);
        }
        
        // Executar sincronização
        const result = await syncVideos(folderId, options);
        
        console.log('\n🎉 Processo finalizado com sucesso!');
        
        if (result.added > 0 && !options.dryRun) {
            console.log('\n💡 Próximos passos:');
            console.log('   1. Revisar os vídeos adicionados no Notion');
            console.log('   2. Preencher descrições e tags conforme necessário');
            console.log('   3. Executar o processo de upload: node 1fetchvideos.js');
        }
        
    } catch (error) {
        console.error('💥 ERRO FATAL:', error.message);
        process.exit(1);
    }
}

// Executar se chamado diretamente
if (require.main === module) {
    main();
}

module.exports = {
    syncVideos,
    getVideosFromDrive,
    getExistingVideosFromNotion,
    addVideoToNotion
};


/*
Funcionalidades:
✅ Detecção automática de vídeos novos

✅ Prevenção de duplicatas por nome e link

✅ Configurações padrão (categoria, privacidade, status)

✅ Informações completas (tamanho, data de criação)

✅ Modo preview para testar

✅ Controle de limite por execução

✅ Logs detalhados de todo o processo
*/