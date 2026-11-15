-- Quantos segundos do minuto tiveram a perda de ping realmente medida (drop_rate não nulo).
-- `samples` conta todas as amostras do minuto; usar `samples` como peso da perda fazia segundos sem medida
-- contarem como "0% de perda" e "disponíveis". Perda e disponibilidade passam a ser ponderadas por esta coluna.
ALTER TABLE quality_minutes ADD COLUMN drop_samples INTEGER;

-- Linhas antigas: não dá para saber a contagem exata. Se havia média de perda, assume o minuto inteiro medido
-- (o comportamento anterior); se não havia, nenhum segundo medido.
UPDATE quality_minutes SET drop_samples = CASE WHEN drop_avg IS NULL THEN 0 ELSE samples END;
