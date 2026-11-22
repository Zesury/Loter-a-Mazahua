ALTER TABLE public.mazahua_members
  ADD COLUMN IF NOT EXISTS last_seen timestamptz;

UPDATE public.mazahua_members
SET last_seen = COALESCE(last_seen, joined_at, now())
WHERE last_seen IS NULL;

ALTER TABLE public.mazahua_members
  ALTER COLUMN last_seen SET DEFAULT now(),
  ALTER COLUMN last_seen SET NOT NULL;

CREATE INDEX IF NOT EXISTS mazahua_members_room_last_seen_idx
  ON public.mazahua_members (room_id, last_seen);

CREATE OR REPLACE FUNCTION public.mazahua_public_state(p_client uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'pg_catalog', 'public'
AS $function$
DECLARE
  room_row public.mazahua_rooms%rowtype;
  member_row public.mazahua_members%rowtype;
BEGIN
  SELECT * INTO room_row
  FROM public.mazahua_rooms
  WHERE status = 'active'
  ORDER BY created_at DESC
  LIMIT 1;

  IF room_row.id IS NULL THEN
    RETURN jsonb_build_object(
      'online', false,
      'events', '[]'::jsonb,
      'players', '[]'::jsonb,
      'serverTime', now()
    );
  END IF;

  IF p_client IS NOT NULL THEN
    UPDATE public.mazahua_members
    SET last_seen = now()
    WHERE room_id = room_row.id AND user_id = p_client;
  END IF;

  DELETE FROM public.mazahua_members
  WHERE room_id = room_row.id
    AND last_seen < now() - interval '2 hours';

  SELECT * INTO member_row
  FROM public.mazahua_members
  WHERE room_id = room_row.id AND user_id = p_client;

  RETURN jsonb_build_object(
    'online', room_row.last_seen > now() - interval '30 seconds',
    'lastSeen', room_row.last_seen,
    'serverTime', now(),
    'gameId', room_row.id,
    'room', room_row.id,
    'status', room_row.status,
    'revision', room_row.revision,
    'events', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
        'id', e.event_id,
        'eventId', e.event_id,
        'cardId', e.card_id,
        'createdAt', e.received_at
      ) ORDER BY e.seq ASC)
      FROM public.mazahua_events e
      WHERE e.room_id = room_row.id
    ), '[]'::jsonb),
    'player', CASE WHEN member_row.user_id IS NULL THEN NULL ELSE jsonb_build_object(
      'number', member_row.board_number,
      'board', member_row.board,
      'marks', COALESCE(member_row.marks, '{}'::integer[]),
      'winner', COALESCE(member_row.winner, false),
      'gameKey', room_row.id
    ) END,
    'players', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
        'number', m.board_number,
        'marks', COALESCE(m.marks, '{}'::integer[]),
        'winner', COALESCE(m.winner, false)
      ) ORDER BY m.board_number)
      FROM public.mazahua_members m
      WHERE m.room_id = room_row.id
        AND m.last_seen >= now() - interval '2 hours'
    ), '[]'::jsonb)
  );
END
$function$;
