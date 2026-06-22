from typing import Dict, List, Optional

class DatasetStore:
    _instance = None

    def __new__(cls):
        if cls._instance is None:
            cls._instance = super(DatasetStore, cls).__new__(cls)
            cls._instance._datasets: Dict[str, any] = {}
            cls._instance._load_datasets()
        return cls._instance

    @classmethod
    def get(cls):
        return cls._instance or cls.__new__(cls)

    def _load_datasets(self):
        # This is a placeholder. In a real application, this would load data
        # from databases, APIs, or files.
        print("Loading datasets...")
        self._datasets["uscis_forms"] = {
            "I-130": "Petition for Alien Relative",
            "I-485": "Application to Register Permanent Residence or Adjust Status",
            "N-400": "Application for Naturalization",
        }
        self._datasets["uk_visa_types"] = [
            "Skilled Worker visa",
            "Student visa",
            "Family visa",
        ]
        self._datasets["canada_pr_programs"] = [
            "Express Entry",
            "Provincial Nominee Program",
            "Family Sponsorship",
        ]
        print("Datasets loaded.")

    def get_dataset(self, name: str) -> Optional[any]:
        return self._datasets.get(name)

    def add_dataset(self, name: str, data: any):
        self._datasets[name] = data
