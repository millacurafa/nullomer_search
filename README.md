# nullomer_search

This project explores absent and shared DNA words in the included bacterial
genome sequences. The main workflow is the documented
[nullomer and shared-sequence notebook](./god_sequence.ipynb).

## Web app

The repository includes a static, browser-based app for exploring sequences:
[open the Genome Words app](https://millacurafa.github.io/nullomer_search/).
The `Deploy static app to GitHub Pages` workflow builds and deploys it on pushes
to `main` and can also be run manually from GitHub Actions. If Pages has not
been enabled for this repository yet, set **Settings → Pages → Build and
deployment → Source** to **GitHub Actions**.

The app can load the included *E. coli* K-12 and *C. metallidurans* CH34 example
genomes, or users can paste or upload their own sequence files. It runs locally
in the browser and includes an optional link to search a shared sequence with
NCBI BLASTN. The absent-word search is capped at 10 bp to keep exhaustive
enumeration practical in a browser.

For a local preview, run `python -m http.server 8000` in the repository folder,
then open `http://localhost:8000`.

## Run the notebook

1. Open `god_sequence.ipynb` in Jupyter or VS Code.
2. Select a Python 3 kernel.
3. Run all cells from the repository root so paths under `data/` resolve.

The notebook uses only the Python standard library. It analyzes the sequence
files already included in `data/` (headerless sequences despite their `.fasta`
suffixes, also compatible with ordinary FASTA records); no downloads or package
installation are needed. Change `GENOME_FILES` in the notebook to select other
genomes. The longest shared sequence is determined from the input lengths; it
is not limited to a preset k-mer size.

The notebook also includes an optional NCBI BLASTN step for a selected longest
shared sequence. It is disabled by default. Enabling it sends the sequence to
NCBI's public `nt` database through the
[BLAST Common URL API](https://blast.ncbi.nlm.nih.gov/doc/blast-help/urlapi.html).
Review that disclosure before setting `RUN_NCBI_BLASTN = True`. The cell waits
for the submitted search and prints a link to its results.

## Terms and scope

- A **k-mer** is a contiguous DNA word of length *k*.
- The notebook reports all **shortest absent words** in *E. coli* K-12, searching
  from length 1 up to `MAX_NULLER_LENGTH`. A result at the configured limit is
  bounded: it does not establish that no longer absent words exist.
- The notebook finds the **longest shared sequence**: the longest exact,
  contiguous DNA substring present in every selected genome. Only maximal
  matches are returned, so their shorter substrings are omitted. The result is
  for the selected input files, not a universal claim. This requested
  shared-sequence analysis is distinct from the paper's definition of **primes**
  as the shortest sequences not found in any reported genome.
- FASTA records and separate input files stay separate, and ambiguous symbols
  such as `N` break sequence runs. This prevents matches from crossing contig
  boundaries or unknown bases. Reverse complements are treated as distinct
  words.
- Absence alone does not establish biological function, lethality, or a reason
  for absence. The notebook does not enumerate every minimal absent word (MAW).

## Reference

Hampikian and Andersen, 2007, [Absent Sequences: Nullomers and Primes](https://psb.stanford.edu/psb-online/proceedings/psb07/hampikian.pdf), *Pacific Symposium on Biocomputing* 12:355–366.
