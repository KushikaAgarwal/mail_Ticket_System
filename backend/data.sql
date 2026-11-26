--
-- PostgreSQL database dump
--

\restrict O6KqWE49TbckCuS2eLVQr0Kf5Vzi0eXMcREHYC5YnFPF3QeBuLxud4WbrqwSThv

-- Dumped from database version 15.18 (Debian 15.18-1.pgdg13+1)
-- Dumped by pg_dump version 15.18 (Debian 15.18-1.pgdg13+1)

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
-- Data for Name: zones; Type: TABLE DATA; Schema: public; Owner: -
--

COPY public.zones (id, name) FROM stdin;
\.


--
-- Data for Name: users; Type: TABLE DATA; Schema: public; Owner: -
--

COPY public.users (id, name, email, password_hash, role, zone_id, created_by, active, created_at, reset_token_hash, reset_token_expires_at) FROM stdin;
\.


--
-- Name: zones_id_seq; Type: SEQUENCE SET; Schema: public; Owner: -
--

SELECT pg_catalog.setval('public.zones_id_seq', 1, false);


--
-- PostgreSQL database dump complete
--

\unrestrict O6KqWE49TbckCuS2eLVQr0Kf5Vzi0eXMcREHYC5YnFPF3QeBuLxud4WbrqwSThv

