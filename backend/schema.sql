--
-- PostgreSQL database dump
--

\restrict eL8eHvd5ZaVzepfRnmJ0d38lYj113FHlhHwUVXlOVmsRauXk2UCWh3j5G5XDPvB

-- Dumped from database version 15.20 (Debian 15.20-1.pgdg13+1)
-- Dumped by pg_dump version 15.20 (Debian 15.20-1.pgdg13+1)

SET statement_timeout = 0;
SET lock_timeout = 0;
SET idle_in_transaction_session_timeout = 0;
SET client_encoding = 'UTF8';
SET standard_conforming_strings = on;
SELECT pg_catalog.set_config('search_path', '', false);
SET check_function_bodies = false;
SET xmloption = content;
SET client_min_messages = warning;
SET row_security = off;

--
-- Name: pgcrypto; Type: EXTENSION; Schema: -; Owner: -
--

CREATE EXTENSION IF NOT EXISTS pgcrypto WITH SCHEMA public;


--
-- Name: EXTENSION pgcrypto; Type: COMMENT; Schema: -; Owner: -
--

COMMENT ON EXTENSION pgcrypto IS 'cryptographic functions';


SET default_tablespace = '';

SET default_table_access_method = heap;

--
-- Name: engineers_cache; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.engineers_cache (
    id character varying(64) NOT NULL,
    name character varying(255),
    email character varying(255),
    last_synced_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: notification_log; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.notification_log (
    id bigint NOT NULL,
    ticket_id uuid,
    type character varying(30) NOT NULL,
    to_email character varying(255),
    message_id character varying(255),
    success boolean DEFAULT true NOT NULL,
    error_message text,
    sent_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: notification_log_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.notification_log_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: notification_log_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.notification_log_id_seq OWNED BY public.notification_log.id;


--
-- Name: ticket_attachments; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.ticket_attachments (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    ticket_id uuid NOT NULL,
    filename character varying(500) NOT NULL,
    content_type character varying(255),
    size_bytes integer,
    storage_path text NOT NULL,
    source_message_id character varying(255),
    uploaded_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: ticket_comments; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.ticket_comments (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    ticket_id uuid NOT NULL,
    author_id character varying(64),
    author_name character varying(255),
    role character varying(20) DEFAULT 'admin'::character varying,
    text text NOT NULL,
    visible boolean DEFAULT true NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: ticket_number_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.ticket_number_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: ticket_status_history; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.ticket_status_history (
    id bigint NOT NULL,
    ticket_id uuid NOT NULL,
    status character varying(20) NOT NULL,
    changed_by character varying(255),
    changed_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: ticket_status_history_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.ticket_status_history_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: ticket_status_history_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.ticket_status_history_id_seq OWNED BY public.ticket_status_history.id;


--
-- Name: ticket_thread_messages; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.ticket_thread_messages (
    id bigint NOT NULL,
    ticket_id uuid NOT NULL,
    message_id character varying(255) NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: ticket_thread_messages_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.ticket_thread_messages_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: ticket_thread_messages_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.ticket_thread_messages_id_seq OWNED BY public.ticket_thread_messages.id;


--
-- Name: tickets; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.tickets (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    ticket_number integer DEFAULT nextval('public.ticket_number_seq'::regclass) NOT NULL,
    process_instance_id character varying(64) NOT NULL,
    source character varying(16) DEFAULT 'email'::character varying NOT NULL,
    business_key character varying(255) NOT NULL,
    subject text,
    description text,
    customer_name character varying(255),
    customer_email character varying(255),
    product_or_category character varying(100),
    urgency character varying(20),
    sentiment character varying(20),
    ticket_status character varying(20) DEFAULT 'OPEN'::character varying NOT NULL,
    assigned_engineer_id character varying(64),
    assigned_engineer_name character varying(255),
    received_at timestamp with time zone,
    last_activity_at timestamp with time zone DEFAULT now() NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    call_id character varying(64),
    caller_number character varying(32),
    agent_id character varying(64),
    call_answered_at timestamp with time zone,
    call_ended_at timestamp with time zone,
    call_duration_seconds integer,
    zone_id integer,
    assigned_by_id uuid,
    assigned_by_role character varying(20),
    assignment_locked boolean DEFAULT false NOT NULL,
    created_by_id uuid,
    created_by_role character varying(20),
    owner_lead_id uuid
);


--
-- Name: users; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.users (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    name character varying(255) NOT NULL,
    email character varying(255) NOT NULL,
    password_hash text NOT NULL,
    role character varying(20) NOT NULL,
    zone_id integer,
    created_by uuid,
    active boolean DEFAULT true NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    reset_token_hash text,
    reset_token_expires_at timestamp with time zone,
    CONSTRAINT users_role_check CHECK (((role)::text = ANY ((ARRAY['SUPER_ADMIN'::character varying, 'SUPERVISOR'::character varying, 'ZONAL_ADMIN'::character varying, 'MANAGER'::character varying, 'LEAD'::character varying, 'CUSTOMER_SUPPORT'::character varying])::text[])))
);


--
-- Name: zones; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.zones (
    id integer NOT NULL,
    name character varying(50) NOT NULL
);


--
-- Name: zones_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.zones_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: zones_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.zones_id_seq OWNED BY public.zones.id;


--
-- Name: notification_log id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.notification_log ALTER COLUMN id SET DEFAULT nextval('public.notification_log_id_seq'::regclass);


--
-- Name: ticket_status_history id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.ticket_status_history ALTER COLUMN id SET DEFAULT nextval('public.ticket_status_history_id_seq'::regclass);


--
-- Name: ticket_thread_messages id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.ticket_thread_messages ALTER COLUMN id SET DEFAULT nextval('public.ticket_thread_messages_id_seq'::regclass);


--
-- Name: zones id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.zones ALTER COLUMN id SET DEFAULT nextval('public.zones_id_seq'::regclass);


--
-- Name: engineers_cache engineers_cache_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.engineers_cache
    ADD CONSTRAINT engineers_cache_pkey PRIMARY KEY (id);


--
-- Name: notification_log notification_log_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.notification_log
    ADD CONSTRAINT notification_log_pkey PRIMARY KEY (id);


--
-- Name: ticket_attachments ticket_attachments_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.ticket_attachments
    ADD CONSTRAINT ticket_attachments_pkey PRIMARY KEY (id);


--
-- Name: ticket_comments ticket_comments_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.ticket_comments
    ADD CONSTRAINT ticket_comments_pkey PRIMARY KEY (id);


--
-- Name: ticket_status_history ticket_status_history_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.ticket_status_history
    ADD CONSTRAINT ticket_status_history_pkey PRIMARY KEY (id);


--
-- Name: ticket_thread_messages ticket_thread_messages_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.ticket_thread_messages
    ADD CONSTRAINT ticket_thread_messages_pkey PRIMARY KEY (id);


--
-- Name: ticket_thread_messages ticket_thread_messages_ticket_id_message_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.ticket_thread_messages
    ADD CONSTRAINT ticket_thread_messages_ticket_id_message_id_key UNIQUE (ticket_id, message_id);


--
-- Name: tickets tickets_business_key_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.tickets
    ADD CONSTRAINT tickets_business_key_key UNIQUE (business_key);


--
-- Name: tickets tickets_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.tickets
    ADD CONSTRAINT tickets_pkey PRIMARY KEY (id);


--
-- Name: tickets tickets_process_instance_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.tickets
    ADD CONSTRAINT tickets_process_instance_id_key UNIQUE (process_instance_id);


--
-- Name: tickets tickets_ticket_number_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.tickets
    ADD CONSTRAINT tickets_ticket_number_key UNIQUE (ticket_number);


--
-- Name: users users_email_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.users
    ADD CONSTRAINT users_email_key UNIQUE (email);


--
-- Name: users users_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.users
    ADD CONSTRAINT users_pkey PRIMARY KEY (id);


--
-- Name: zones zones_name_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.zones
    ADD CONSTRAINT zones_name_key UNIQUE (name);


--
-- Name: zones zones_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.zones
    ADD CONSTRAINT zones_pkey PRIMARY KEY (id);


--
-- Name: idx_attachments_ticket; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_attachments_ticket ON public.ticket_attachments USING btree (ticket_id);


--
-- Name: idx_comments_ticket; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_comments_ticket ON public.ticket_comments USING btree (ticket_id, created_at);


--
-- Name: idx_notifications_ticket; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_notifications_ticket ON public.notification_log USING btree (ticket_id, sent_at DESC);


--
-- Name: idx_status_history_ticket; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_status_history_ticket ON public.ticket_status_history USING btree (ticket_id, changed_at);


--
-- Name: idx_thread_message_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_thread_message_id ON public.ticket_thread_messages USING btree (message_id);


--
-- Name: idx_tickets_assignee; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_tickets_assignee ON public.tickets USING btree (assigned_engineer_id, ticket_status);


--
-- Name: idx_tickets_created_by; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_tickets_created_by ON public.tickets USING btree (created_by_id);


--
-- Name: idx_tickets_customer_email; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_tickets_customer_email ON public.tickets USING btree (customer_email);


--
-- Name: idx_tickets_owner_lead; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_tickets_owner_lead ON public.tickets USING btree (owner_lead_id);


--
-- Name: idx_tickets_status_activity; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_tickets_status_activity ON public.tickets USING btree (ticket_status, last_activity_at DESC);


--
-- Name: idx_tickets_zone; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_tickets_zone ON public.tickets USING btree (zone_id, ticket_status);


--
-- Name: idx_users_created_by; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_users_created_by ON public.users USING btree (created_by);


--
-- Name: idx_users_reset_token_hash; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_users_reset_token_hash ON public.users USING btree (reset_token_hash);


--
-- Name: idx_users_role_zone; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_users_role_zone ON public.users USING btree (role, zone_id);


--
-- Name: notification_log notification_log_ticket_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.notification_log
    ADD CONSTRAINT notification_log_ticket_id_fkey FOREIGN KEY (ticket_id) REFERENCES public.tickets(id) ON DELETE CASCADE;


--
-- Name: ticket_attachments ticket_attachments_ticket_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.ticket_attachments
    ADD CONSTRAINT ticket_attachments_ticket_id_fkey FOREIGN KEY (ticket_id) REFERENCES public.tickets(id) ON DELETE CASCADE;


--
-- Name: ticket_comments ticket_comments_ticket_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.ticket_comments
    ADD CONSTRAINT ticket_comments_ticket_id_fkey FOREIGN KEY (ticket_id) REFERENCES public.tickets(id) ON DELETE CASCADE;


--
-- Name: ticket_status_history ticket_status_history_ticket_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.ticket_status_history
    ADD CONSTRAINT ticket_status_history_ticket_id_fkey FOREIGN KEY (ticket_id) REFERENCES public.tickets(id) ON DELETE CASCADE;


--
-- Name: ticket_thread_messages ticket_thread_messages_ticket_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.ticket_thread_messages
    ADD CONSTRAINT ticket_thread_messages_ticket_id_fkey FOREIGN KEY (ticket_id) REFERENCES public.tickets(id) ON DELETE CASCADE;


--
-- Name: tickets tickets_assigned_by_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.tickets
    ADD CONSTRAINT tickets_assigned_by_id_fkey FOREIGN KEY (assigned_by_id) REFERENCES public.users(id);


--
-- Name: tickets tickets_created_by_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.tickets
    ADD CONSTRAINT tickets_created_by_id_fkey FOREIGN KEY (created_by_id) REFERENCES public.users(id);


--
-- Name: tickets tickets_owner_lead_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.tickets
    ADD CONSTRAINT tickets_owner_lead_id_fkey FOREIGN KEY (owner_lead_id) REFERENCES public.users(id);


--
-- Name: tickets tickets_zone_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.tickets
    ADD CONSTRAINT tickets_zone_id_fkey FOREIGN KEY (zone_id) REFERENCES public.zones(id);


--
-- Name: users users_created_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.users
    ADD CONSTRAINT users_created_by_fkey FOREIGN KEY (created_by) REFERENCES public.users(id);


--
-- Name: users users_zone_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.users
    ADD CONSTRAINT users_zone_id_fkey FOREIGN KEY (zone_id) REFERENCES public.zones(id);


--
-- PostgreSQL database dump complete
--

\unrestrict eL8eHvd5ZaVzepfRnmJ0d38lYj113FHlhHwUVXlOVmsRauXk2UCWh3j5G5XDPvB

