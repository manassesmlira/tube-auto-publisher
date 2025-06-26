const { Client } = require('@notionhq/client');
require('dotenv').config();

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
 * Formata data para o Notion
 * @param {Date|string} date - Data para formatar
 * @returns {string} - Data formatada ISO
 */
function formatNotionDate(date) {
    if (!date) return new Date().toISOString();
    
    if (typeof date === 'string') {
        return new Date(date).toISOString();
    }
    
    return date.toISOString();
}

/**
 * Cria texto rico para campos do Notion
 * @param {string} text - Texto simples
 * @returns {Array} - Array de objetos rich_text
 */
function createRichText(text) {
    if (!text) return [];
    
    return [{
        type: 'text',
        text: {
            content: text.substring(0, 2000) // Limite do Notion
        }
    }];
}

/**
 * Atualiza propriedades da página no Notion
 * @param {string} pageId - ID da página
 * @param {Object} uploadResult - Resultado do upload YouTube
 * @param {Object} videoData - Dados originais do vídeo
 * @returns {Object} - Resultado da atualização
 */
async function updateNotionPage(pageId, uploadResult, videoData = null) {
    try {
        console.log('📝 Atualizando página no Notion...');
        console.log(`   📄 ID da página: ${pageId}`);
        
        // Preparar propriedades para atualização
        const properties = {
            'Upload Status': {
                select: {
                    name: uploadResult.success ? 'Uploaded' : 'Error'
                }
            },
            'Upload Date': {
                date: {
                    start: formatNotionDate(uploadResult.uploadDate)
                }
            }
        };
        
        // Adicionar URL do YouTube se upload foi bem-sucedido
        if (uploadResult.success && uploadResult.videoUrl) {
            properties['YouTube URL'] = {
                url: uploadResult.videoUrl
            };
            
            console.log(`🎬 YouTube URL: ${uploadResult.videoUrl}`);
        }
        
        // Adicionar ID do vídeo se disponível
        if (uploadResult.videoId) {
            properties['Video ID'] = {
                rich_text: createRichText(uploadResult.videoId)
            };
            
            console.log(`🆔 Video ID: ${uploadResult.videoId}`);
        }
        
        // Adicionar thumbnail URL se disponível
        if (uploadResult.thumbnailUrl) {
            properties['Thumbnail URL'] = {
                url: uploadResult.thumbnailUrl
            };
        }
        
        // Adicionar informações de upload se bem-sucedido
        if (uploadResult.success) {
            // Tempo de upload
            if (uploadResult.uploadTimeSeconds) {
                properties['Upload Time (s)'] = {
                    number: uploadResult.uploadTimeSeconds
                };
            }
            
            // Tamanho do arquivo
            if (uploadResult.fileSize) {
                properties['File Size (MB)'] = {
                    number: Math.round(uploadResult.fileSize / 1024 / 1024)
                };
            }
            
            // Status de privacidade
            if (uploadResult.privacy) {
                properties['Final Privacy'] = {
                    select: {
                        name: uploadResult.privacy.charAt(0).toUpperCase() + uploadResult.privacy.slice(1)
                    }
                };
            }
            
            console.log('✅ Propriedades de sucesso adicionadas');
        }
        
        // Adicionar mensagem de erro se upload falhou
        if (!uploadResult.success && uploadResult.error) {
            properties['Error Message'] = {
                rich_text: createRichText(uploadResult.error)
            };
            
            properties['Error Date'] = {
                date: {
                    start: formatNotionDate(new Date())
                }
            };
            
            console.log(`❌ Erro registrado: ${uploadResult.error}`);
        }
        
        // Adicionar tentativas de upload
        if (uploadResult.attempts) {
            properties['Upload Attempts'] = {
                number: uploadResult.attempts
            };
        }
        
        // Fazer a atualização
        const response = await notion.pages.update({
            page_id: pageId,
            properties: properties
        });
        
        console.log('✅ Página atualizada com sucesso');
        
        // Verificar se a atualização foi bem-sucedida
        if (response.id === pageId) {
            return {
                success: true,
                pageId: pageId,
                updatedAt: response.last_edited_time,
                properties: Object.keys(properties)
            };
        } else {
            throw new Error('❌ Resposta inesperada do Notion');
        }
        
    } catch (error) {
        console.error('❌ Erro ao atualizar Notion:', error.message);
        throw error;
    }
}

/**
 * Marca vídeo como erro no Notion
 * @param {string} pageId - ID da página
 * @param {string} errorMessage - Mensagem de erro
 * @param {number} attempts - Número de tentativas
 * @returns {Object} - Resultado da atualização
 */
async function markAsError(pageId, errorMessage, attempts = 1) {
    try {
        console.log('❌ Marcando vídeo como erro...');
        
        const errorResult = {
            success: false,
            error: errorMessage,
            uploadDate: new Date().toISOString(),
            attempts: attempts
        };
        
        return await updateNotionPage(pageId, errorResult);
        
    } catch (error) {
        console.error('❌ Erro ao marcar como erro:', error.message);
        throw error;
    }
}

/**
 * Incrementa contador de tentativas
 * @param {string} pageId - ID da página
 * @returns {number} - Número atual de tentativas
 */
async function incrementAttempts(pageId) {
    try {
        console.log('🔄 Incrementando tentativas...');
        
        // Obter página atual
        const page = await notion.pages.retrieve({ page_id: pageId });
        const currentAttempts = page.properties['Upload Attempts']?.number || 0;
        const newAttempts = currentAttempts + 1;
        
        // Atualizar contador
        await notion.pages.update({
            page_id: pageId,
            properties: {
                'Upload Attempts': {
                    number: newAttempts
                },
                'Last Attempt': {
                    date: {
                        start: new Date().toISOString()
                    }
                }
            }
        });
        
        console.log(`🔢 Tentativas: ${newAttempts}`);
        return newAttempts;
        
    } catch (error) {
        console.error('❌ Erro ao incrementar tentativas:', error.message);
        return 1;
    }
}

/**
 * Adiciona comentário na página do Notion
 * @param {string} pageId - ID da página
 * @param {string} comment - Comentário a adicionar
 */
async function addComment(pageId, comment) {
    try {
        console.log('💬 Adicionando comentário...');
        
        await notion.comments.create({
            parent: {
                page_id: pageId
            },
            rich_text: createRichText(comment)
        });
        
        console.log('✅ Comentário adicionado');
        
    } catch (error) {
        console.warn('⚠️ Erro ao adicionar comentário:', error.message);
    }
}

/**
 * Obtém estatísticas do banco de dados
 * @returns {Object} - Estatísticas
 */
async function getDatabaseStats() {
    try {
        console.log('📊 Obtendo estatísticas do banco...');
        
        validateEnvironmentVariables();
        
        // Buscar todas as páginas
        const allPages = await notion.databases.query({
            database_id: process.env.NOTION_DATABASE_ID,
            page_size: 100
        });
        
        // Contar por status
        const stats = {
            total: allPages.results.length,
            pending: 0,
            uploaded: 0,
            error: 0,
            totalUploads: 0,
            lastUpload: null
        };
        
        allPages.results.forEach(page => {
            const status = page.properties['Upload Status']?.select?.name;
            const uploadDate = page.properties['Upload Date']?.date?.start;
            
            switch (status) {
                case 'Pending':
                    stats.pending++;
                    break;
                case 'Uploaded':
                    stats.uploaded++;
                    stats.totalUploads++;
                    if (uploadDate && (!stats.lastUpload || uploadDate > stats.lastUpload)) {
                        stats.lastUpload = uploadDate;
                    }
                    break;
                case 'Error':
                    stats.error++;
                    break;
            }
        });
        
        console.log('📈 Estatísticas:');
        console.log(`   📊 Total: ${stats.total}`);
        console.log(`   ⏳ Pendentes: ${stats.pending}`);
        console.log(`   ✅ Enviados: ${stats.uploaded}`);
        console.log(`   ❌ Erros: ${stats.error}`);
        console.log(`   📅 Último upload: ${stats.lastUpload || 'Nunca'}`);
        
        return stats;
        
    } catch (error) {
        console.error('❌ Erro ao obter estatísticas:', error.message);
        throw error;
    }
}

/**
 * Limpa vídeos com erro após X dias
 * @param {number} days - Dias para considerar antigo
 * @returns {number} - Número de páginas limpas
 */
async function cleanupOldErrors(days = 7) {
    try {
        console.log(`🧹 Limpando erros com mais de ${days} dias...`);
        
        const cutoffDate = new Date();
        cutoffDate.setDate(cutoffDate.getDate() - days);
        
        // Buscar páginas com erro
        const errorPages = await notion.databases.query({
            database_id: process.env.NOTION_DATABASE_ID,
            filter: {
                and: [
                    {
                        property: 'Upload Status',
                        select: {
                            equals: 'Error'
                        }
                    },
                    {
                        property: 'Error Date',
                        date: {
                            before: cutoffDate.toISOString()
                        }
                    }
                ]
            }
        });
        
        let cleaned = 0;
        
        for (const page of errorPages.results) {
            try {
                // Resetar para Pending
                await notion.pages.update({
                    page_id: page.id,
                    properties: {
                        'Upload Status': {
                            select: {
                                name: 'Pending'
                            }
                        },
                        'Error Message': {
                            rich_text: []
                        },
                        'Upload Attempts': {
                            number: 0
                        }
                    }
                });
                
                cleaned++;
                console.log(`🔄 Reset: ${page.properties['Video Title']?.title?.[0]?.plain_text || 'Sem título'}`);
                
            } catch (resetError) {
                console.warn(`⚠️ Erro ao resetar página ${page.id}:`, resetError.message);
            }
        }
        
        console.log(`✅ ${cleaned} página(s) resetada(s)`);
        return cleaned;
        
    } catch (error) {
        console.error('❌ Erro na limpeza:', error.message);
        return 0;
    }
}

/**
 * Função principal de atualização
 * @param {string} pageId - ID da página
 * @param {Object} uploadResult - Resultado do upload
 * @param {Object} videoData - Dados originais
 * @returns {Object} - Resultado da operação
 */
async function updateNotionAfterUpload(pageId, uploadResult, videoData = null) {
    try {
        console.log('🔄 Iniciando atualização do Notion...');
        
        validateEnvironmentVariables();
        
        // Atualizar página principal
        const updateResult = await updateNotionPage(pageId, uploadResult, videoData);
        
        // Adicionar comentário informativo
        if (uploadResult.success) {
            const comment = `✅ Upload concluído com sucesso!\n` +
                          `🎬 URL: ${uploadResult.videoUrl}\n` +
                          `⏱️ Tempo: ${uploadResult.uploadTimeSeconds}s\n` +
                          `📅 Data: ${new Date(uploadResult.uploadDate).toLocaleString('pt-BR')}`;
            
            await addComment(pageId, comment);
        } else {
            // Incrementar tentativas em caso de erro
            await incrementAttempts(pageId);
            
            const comment = `❌ Erro no upload:\n${uploadResult.error}\n` +
                          `📅 Data: ${new Date().toLocaleString('pt-BR')}`;
            
            await addComment(pageId, comment);
        }
        
        console.log('✅ Atualização do Notion concluída');
        
        return updateResult;
        
    } catch (error) {
        console.error('❌ Erro na atualização completa:', error.message);
        throw error;
    }
}

module.exports = {
    updateNotionAfterUpload,
    updateNotionPage,
    markAsError,
    incrementAttempts,
    addComment,
    getDatabaseStats,
    cleanupOldErrors,
    createRichText,
    formatNotionDate
};

/*
🎯 PRINCIPAIS FUNCIONALIDADES:
✅ ATUALIZAÇÃO COMPLETA:
Status do upload (Uploaded/Error)
URL do YouTube e ID do vídeo
Data/hora do upload
Informações técnicas (tamanho, tempo)
📊 GESTÃO DE DADOS:
✅ Contador de tentativas
✅ Mensagens de erro detalhadas
✅ Thumbnails e metadados
✅ Estatísticas do banco
🛡️ RECUPERAÇÃO E LIMPEZA:
✅ Reset automático de erros antigos
✅ Incremento de tentativas
✅ Comentários informativos
✅ Validação de dados
🔧 RECURSOS AVANÇADOS:
✅ Formatação automática de datas
✅ Textos ricos para campos longos
✅ Estatísticas detalhadas
✅ Logs informativos
💬 COMENTÁRIOS AUTOMÁTICOS:
✅ Sucesso com detalhes
✅ Erros com timestamps
✅ Informações de upload
✅ Histórico de tentativas
*/