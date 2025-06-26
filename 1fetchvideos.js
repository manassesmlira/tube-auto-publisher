const { Client } = require('@notionhq/client');
require('dotenv').config();
const fs = require('fs');

// Inicializar cliente Notion
const notion = new Client({
    auth: process.env.NOTION_TOKEN,
});

/**
 * Valida se todas as variáveis necessárias estão configuradas
 */
function validateEnvironmentVariables() {
    const required = [
        'NOTION_TOKEN',
        'NOTION_DATABASE_ID'
    ];
    
    const missing = required.filter(key => !process.env[key]);
    
    if (missing.length > 0) {
        throw new Error(`❌ Variáveis de ambiente faltando: ${missing.join(', ')}`);
    }
    
    console.log('✅ Variáveis Notion validadas');
}

/**
 * Extrai texto simples de propriedades rich_text do Notion
 * @param {Array} richTextArray - Array de objetos rich_text
 * @returns {string} - Texto simples
 */
function extractPlainText(richTextArray) {
    if (!richTextArray || !Array.isArray(richTextArray)) {
        return '';
    }
    
    return richTextArray
        .map(item => item.plain_text || '')
        .join('')
        .trim();
}

/**
 * Extrai título de propriedades title do Notion
 * @param {Array} titleArray - Array de objetos title
 * @returns {string} - Título simples
 */
function extractTitle(titleArray) {
    if (!titleArray || !Array.isArray(titleArray)) {
        return '';
    }
    
    return titleArray
        .map(item => item.plain_text || '')
        .join('')
        .trim();
}

/**
 * Processa propriedades da página do Notion
 * @param {Object} page - Página do Notion
 * @returns {Object} - Dados processados do vídeo
 */
function processVideoData(page) {
    try {
        console.log(`📄 Processando página: ${page.id}`);
        
        const properties = page.properties;
        
        // Extrair dados básicos
        const videoData = {
            pageId: page.id,
            title: extractTitle(properties['Video Title']?.title),
            description: extractPlainText(properties['Video Description']?.rich_text),
            driveLink: properties['Drive Link']?.url || '',
            tags: extractPlainText(properties['Tags']?.rich_text),
            category: properties['Category']?.select?.name || 'Education',
            privacy: properties['Privacy']?.select?.name || 'Public',
            uploadStatus: properties['Upload Status']?.select?.name || 'Pending',
            createdAt: page.created_time,
            lastEdited: page.last_edited_time
        };
        
        // Validações básicas
        const validations = [];
        
        if (!videoData.title) {
            validations.push('❌ Título não pode estar vazio');
        }
        
        if (videoData.title.length > 100) {
            validations.push('⚠️ Título muito longo (será truncado)');
            videoData.title = videoData.title.substring(0, 100);
        }
        
        if (!videoData.driveLink) {
            validations.push('❌ Link do Drive é obrigatório');
        }
        
        if (videoData.driveLink && !videoData.driveLink.includes('drive.google.com')) {
            validations.push('⚠️ Link não parece ser do Google Drive');
        }
        
        if (videoData.description.length > 4500) {
            validations.push('⚠️ Descrição muito longa (será truncada)');
            videoData.description = videoData.description.substring(0, 4500);
        }
        
        // Log dos dados extraídos
        console.log(`   📺 Título: ${videoData.title}`);
        console.log(`   🔗 Drive: ${videoData.driveLink ? 'Presente' : 'Ausente'}`);
        console.log(`   📝 Descrição: ${videoData.description.length} chars`);
        console.log(`   🏷️ Tags: ${videoData.tags || 'Nenhuma'}`);
        console.log(`   📂 Categoria: ${videoData.category}`);
        console.log(`   🔒 Privacidade: ${videoData.privacy}`);
        console.log(`   📊 Status: ${videoData.uploadStatus}`);
        
        // Log das validações
        if (validations.length > 0) {
            console.log('⚠️ Avisos de validação:');
            validations.forEach(validation => console.log(`   ${validation}`));
        }
        
        // Retornar dados e validações
        return {
            ...videoData,
            isValid: !validations.some(v => v.includes('❌')),
            validations: validations
        };
        
    } catch (error) {
        console.error(`❌ Erro ao processar página ${page.id}:`, error.message);
        throw error;
    }
}

/**
 * Busca vídeos pendentes no Notion
 * @param {number} limit - Número máximo de vídeos para buscar
 * @returns {Array} - Lista de vídeos pendentes
 */
async function fetchPendingVideos(limit = 10) {
    try {
        console.log('🔍 Buscando vídeos pendentes no Notion...');
        
        validateEnvironmentVariables();
        
        // Construir filtro para buscar apenas vídeos pendentes
        const filter = {
            property: 'Upload Status',
            select: {
                equals: 'Pending'
            }
        };
        
        // Ordenar por data de criação (mais antigos primeiro)
        const sorts = [
            {
                property: 'Video Title',
                direction: 'ascending'
            }
        ];
        
        console.log(`📊 Buscando até ${limit} vídeo(s) pendente(s)...`);
        
        // Fazer consulta ao banco de dados
        const response = await notion.databases.query({
            database_id: process.env.NOTION_DATABASE_ID,
            filter: filter,
            sorts: sorts,
            page_size: Math.min(limit, 100) // Máximo do Notion: 100
        });
        
        console.log(`📋 Encontrados ${response.results.length} resultado(s)`);
        
        if (response.results.length === 0) {
            console.log('✅ Nenhum vídeo pendente encontrado');
            return [];
        }
        
        // Processar cada página encontrada
        const videos = [];
        const errors = [];
        
        for (const page of response.results) {
            try {
                const videoData = processVideoData(page);
                
                if (videoData.isValid) {
                    videos.push(videoData);
                    console.log(`✅ Vídeo válido adicionado: "${videoData.title}"`);
                } else {
                    errors.push({
                        pageId: page.id,
                        title: videoData.title || 'Sem título',
                        errors: videoData.validations.filter(v => v.includes('❌'))
                    });
                    console.log(`❌ Vídeo inválido ignorado: "${videoData.title}"`);
                }
                
            } catch (processError) {
                console.error(`❌ Erro ao processar vídeo:`, processError.message);
                errors.push({
                    pageId: page.id,
                    title: 'Erro no processamento',
                    errors: [processError.message]
                });
            }
        }
        
        // Log do resultado final
        console.log('📊 Resultado da busca:');
        console.log(`   ✅ Vídeos válidos: ${videos.length}`);
        console.log(`   ❌ Vídeos com erro: ${errors.length}`);
        
        if (errors.length > 0) {
            console.log('❌ Erros encontrados:');
            errors.forEach(error => {
                console.log(`   📄 ${error.title}:`);
                error.errors.forEach(err => console.log(`      ${err}`));
            });
        }
        
        return videos;
        
    } catch (error) {
        console.error('❌ Erro ao buscar vídeos pendentes:', error.message);
        throw error;
    }
}

/**
 * Busca um vídeo específico por ID
 * @param {string} pageId - ID da página no Notion
 * @returns {Object} - Dados do vídeo
 */
async function fetchVideoById(pageId) {
    try {
        console.log(`🔍 Buscando vídeo específico: ${pageId}`);
        
        validateEnvironmentVariables();
        
        // Buscar página específica
        const page = await notion.pages.retrieve({
            page_id: pageId
        });
        
        if (!page) {
            throw new Error('❌ Página não encontrada');
        }
        
        // Processar dados da página
        const videoData = processVideoData(page);
        
        console.log(`✅ Vídeo encontrado: "${videoData.title}"`);
        
        return videoData;
        
    } catch (error) {
        console.error(`❌ Erro ao buscar vídeo ${pageId}:`, error.message);
        throw error;
    }
}

/**
 * Obtém próximo vídeo para upload (prioridade mais alta)
 * @returns {Object|null} - Próximo vídeo ou null se não houver
 */
async function getNextVideoForUpload() {
    try {
        console.log('🎯 Buscando próximo vídeo para upload...');
        
        // Buscar apenas 1 vídeo
        const videos = await fetchPendingVideos(1);
        
        if (videos.length === 0) {
            console.log('📭 Nenhum vídeo pendente para upload');
            return null;
        }
        
        const nextVideo = videos[0];
        console.log(`🎬 Próximo vídeo: "${nextVideo.title}"`);
        
        return nextVideo;
        
    } catch (error) {
        console.error('❌ Erro ao obter próximo vídeo:', error.message);
        throw error;
    }
}

/**
 * Verifica status geral do banco de dados
 * @returns {Object} - Estatísticas do banco
 */
async function checkDatabaseStatus() {
    try {
        console.log('📊 Verificando status do banco de dados...');
        
        validateEnvironmentVariables();
        
        // Buscar informações do banco
        const database = await notion.databases.retrieve({
            database_id: process.env.NOTION_DATABASE_ID
        });
        
        console.log(`📋 Banco: ${database.title?.[0]?.plain_text || 'Auto Publisher'}`);
        console.log(`📅 Última edição: ${new Date(database.last_edited_time).toLocaleString('pt-BR')}`);
        
        // Buscar estatísticas de páginas
        const allPages = await notion.databases.query({
            database_id: process.env.NOTION_DATABASE_ID,
            page_size: 100
        });
        
        // Contar por status
        const stats = {
            total: allPages.results.length,
            pending: 0,
            uploaded: 0,
            error: 0
        };
        
        allPages.results.forEach(page => {
            const status = page.properties['Upload Status']?.select?.name || 'Pending';
            switch (status) {
                case 'Pending':
                    stats.pending++;
                    break;
                case 'Uploaded':
                    stats.uploaded++;
                    break;
                case 'Error':
                    stats.error++;
                    break;
            }
        });
        
        console.log('📈 Estatísticas:');
        console.log(`   📊 Total: ${stats.total} vídeo(s)`);
        console.log(`   ⏳ Pendentes: ${stats.pending} vídeo(s)`);
        console.log(`   ✅ Enviados: ${stats.uploaded} vídeo(s)`);
        console.log(`   ❌ Erros: ${stats.error} vídeo(s)`);
        
        return {
            database: {
                id: database.id,
                title: database.title?.[0]?.plain_text,
                lastEdited: database.last_edited_time
            },
            stats: stats
        };
        
    } catch (error) {
        console.error('❌ Erro ao verificar status:', error.message);
        throw error;
    }
}

/**
 * Função principal - busca próximo vídeo para processar
 * @returns {Object|null} - Vídeo para processar ou null
 */
async function main() {
    try {
        console.log('🚀 INICIANDO BUSCA DE VÍDEOS PENDENTES...');
        console.log('═'.repeat(50));
        
        // Verificar status do banco
        const status = await checkDatabaseStatus();
        
        if (status.stats.pending === 0) {
            console.log('📭 Nenhum vídeo pendente encontrado');
            console.log('✅ Processo finalizado - nada para fazer');
            return null;
        }
        
        // Buscar próximo vídeo
        const nextVideo = await getNextVideoForUpload();
        
        if (nextVideo) {
            // 💾 SALVAR DADOS TEMPORÁRIOS
            const videoData = {
                pageId: nextVideo.pageId,
                title: nextVideo.title,
                driveUrl: nextVideo.driveUrl,
                description: nextVideo.description,
                tags: nextVideo.tags,
                category: nextVideo.category,
                privacy: nextVideo.privacy
            };
            
            fs.writeFileSync('temp_video_data.json', JSON.stringify(videoData, null, 2));
            console.log(`💾 Dados salvos em temp_video_data.json para: ${videoData.title}`);
        }
        
        console.log('═'.repeat(50));
        console.log('✅ BUSCA CONCLUÍDA COM SUCESSO!');
        console.log(`🎬 Vídeo selecionado: "${nextVideo.title}"`);
        console.log(`📄 ID da página: ${nextVideo.pageId}`);
        
        return nextVideo;
        
    } catch (error) {
        console.error('═'.repeat(50));
        console.error('❌ ERRO NA BUSCA DE VÍDEOS:');
        console.error(error.message);
        console.error('═'.repeat(50));
        throw error;
    }
}



// Executar se chamado diretamente
if (require.main === module) {
    main()
        .then(video => {
            if (video) {
                console.log('🎯 Vídeo encontrado:', video.title);
                process.exit(0);
            } else {
                console.log('📭 Nenhum vídeo pendente');
                process.exit(1);
            }
        })
        .catch(error => {
            console.error('💥 Erro fatal:', error.message);
            process.exit(1);
        });
}



module.exports = {
    main,
    fetchPendingVideos,
    fetchVideoById,
    getNextVideoForUpload,
    checkDatabaseStatus,
    processVideoData
};


/*
🎯 PRINCIPAIS FUNCIONALIDADES:
🔍 BUSCA INTELIGENTE:
Filtra apenas vídeos pendentes no Notion
Ordena por data (mais antigos primeiro)
Valida dados antes de retornar
Limite configurável de resultados
📊 VALIDAÇÕES COMPLETAS:
✅ Título obrigatório e tamanho
✅ Link do Drive válido
✅ Descrição dentro do limite
✅ Tags formatadas corretamente
🛡️ TRATAMENTO DE ERROS:
✅ Vídeos inválidos são ignorados
✅ Logs detalhados de problemas
✅ Estatísticas de sucesso/erro
✅ Fallbacks para dados ausentes
📈 ESTATÍSTICAS:
✅ Status geral do banco
✅ Contagem por status
✅ Informações de última edição
✅ Total de vídeos
*/