'use strict';

function boundedPodium(value, fallback, minimum, maximum) {
  const parsed = Number(value);
  const podium = Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
  return Math.max(minimum, Math.min(maximum, podium));
}

function contextualArrivalComplete(item, category) {
  const explicit = category === 'ecd'
    ? item?.ecdArrivalComplete
    : item?.nationalArrivalComplete;
  if (typeof explicit === 'boolean') return explicit;
  if (item?.category === category && typeof item?.arrivalComplete === 'boolean') {
    return item.arrivalComplete;
  }
  return (item?.winners || []).length >= historyPodiumSize(item, category);
}

function historyPredictionVariant(item, category) {
  if (category !== 'ecd' || !Array.isArray(item?.ecdTopPicks)) return item;
  const podiumSize = boundedPodium(item.ecdTicketOutcome?.podiumSize, 3, 2, 3);
  const baseNumber = Number(item.ecdTopPicks[0]?.number);
  const arrivalComplete = contextualArrivalComplete(item, category);
  const basePlaced = arrivalComplete && Number.isFinite(baseNumber)
    && (item.winners || []).slice(0, podiumSize).map(Number).includes(baseNumber);
  return {
    ...item,
    topPicks: item.ecdTopPicks,
    groups: item.ecdGroups || item.groups,
    aiHit: arrivalComplete
      ? (typeof item.ecdAiHit === 'boolean' ? item.ecdAiHit : basePlaced)
      : null,
  };
}

function historyPodiumSize(item, category) {
  if (category === 'ecd') {
    return boundedPodium(
      item?.ecdTicketOutcome?.podiumSize
        ?? item?.ecdGroups?.format?.places
        ?? item?.groups?.format?.places,
      3,
      2,
      3
    );
  }
  return boundedPodium(
    item?.nationalGroups?.format?.places
      ?? item?.groups?.format?.places
      ?? item?.grandCarnetOutcome?.arrival?.length,
    3,
    1,
    5
  );
}

function contextualPodium(item, category) {
  return (item?.winners || [])
    .slice(0, historyPodiumSize(item, category))
    .map(Number)
    .filter(Number.isFinite);
}

module.exports = {
  historyPredictionVariant,
  historyPodiumSize,
  contextualPodium,
  contextualArrivalComplete,
};
